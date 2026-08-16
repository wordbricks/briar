import Foundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum PhotoAttachmentImportPolicy: Sendable {
    case imagesOnly
    case imagesAndVideos

    var pickerFilter: PHPickerFilter {
        switch self {
        case .imagesOnly:
            .images
        case .imagesAndVideos:
            .any(of: [.images, .videos])
        }
    }

    fileprivate func accepts(_ type: UTType) -> Bool {
        switch self {
        case .imagesOnly:
            type.conforms(to: .image)
        case .imagesAndVideos:
            type.conforms(to: .image) || type.conforms(to: .movie)
        }
    }

    fileprivate var unsupportedMessage: String {
        switch self {
        case .imagesOnly:
            L10n.text("선택한 이미지 형식을 첨부할 수 없습니다.")
        case .imagesAndVideos:
            L10n.text("선택한 이미지·영상 형식을 첨부할 수 없습니다.")
        }
    }
}

@MainActor
struct PhotoAttachmentSelection {
    let supportedContentTypes: [UTType]
    private let loadData: () async throws -> Data?

    init(_ item: PhotosPickerItem) {
        supportedContentTypes = item.supportedContentTypes
        loadData = { try await item.loadTransferable(type: Data.self) }
    }

    init(
        supportedContentTypes: [UTType],
        loadData: @escaping () async throws -> Data?
    ) {
        self.supportedContentTypes = supportedContentTypes
        self.loadData = loadData
    }

    fileprivate func data() async throws -> Data? {
        try await loadData()
    }
}

enum PhotoAttachmentImportError: LocalizedError, Equatable {
    case unreadable
    case unsupported(String)
    case validation(String)

    var errorDescription: String? {
        switch self {
        case .unreadable:
            L10n.text("사진 앱에서 선택한 항목을 읽지 못했습니다.")
        case let .unsupported(message), let .validation(message):
            message
        }
    }
}

@MainActor
enum PhotoAttachmentImporter {
    static func importItems(
        _ items: [PhotosPickerItem],
        appendingTo attachments: [PendingIssueAttachment],
        policy: PhotoAttachmentImportPolicy,
        filenameIdentifier: () -> String = { UUID().uuidString }
    ) async throws -> [PendingIssueAttachment] {
        try await importSelections(
            items.map(PhotoAttachmentSelection.init),
            appendingTo: attachments,
            policy: policy,
            filenameIdentifier: filenameIdentifier
        )
    }

    static func importSelections(
        _ selections: [PhotoAttachmentSelection],
        appendingTo attachments: [PendingIssueAttachment],
        policy: PhotoAttachmentImportPolicy,
        filenameIdentifier: () -> String = { UUID().uuidString }
    ) async throws -> [PendingIssueAttachment] {
        var loaded = attachments
        if let message = PendingIssueAttachment.validationMessage(for: loaded) {
            throw PhotoAttachmentImportError.validation(message)
        }
        for selection in selections.prefix(PendingIssueAttachment.maximumCount - loaded.count) {
            let data: Data
            do {
                guard let selectedData = try await selection.data() else {
                    throw PhotoAttachmentImportError.unreadable
                }
                data = selectedData
            } catch let error as PhotoAttachmentImportError {
                throw error
            } catch {
                throw PhotoAttachmentImportError.unreadable
            }

            loaded.append(try attachment(
                data: data,
                supportedContentTypes: selection.supportedContentTypes,
                policy: policy,
                filenameIdentifier: filenameIdentifier()
            ))
        }
        if let message = PendingIssueAttachment.validationMessage(for: loaded) {
            throw PhotoAttachmentImportError.validation(message)
        }
        return loaded
    }

    private static func attachment(
        data: Data,
        supportedContentTypes: [UTType],
        policy: PhotoAttachmentImportPolicy,
        filenameIdentifier: String
    ) throws -> PendingIssueAttachment {
        let supportedType = supportedContentTypes.first { type in
            guard policy.accepts(type),
                  let mimeType = type.preferredMIMEType else { return false }
            return PendingIssueAttachment.allowedContentTypes.contains(mimeType)
        }
        if let supportedType,
           let mimeType = supportedType.preferredMIMEType {
            let kind = supportedType.conforms(to: .movie) ? "video" : "image"
            return PendingIssueAttachment(
                filename: "\(kind)-\(filenameIdentifier).\(supportedType.preferredFilenameExtension ?? "bin")",
                contentType: mimeType,
                data: data
            )
        }

        if supportedContentTypes.contains(where: { $0.conforms(to: .image) }),
           let jpegData = UIImage(data: data)?.jpegData(compressionQuality: 0.9) {
            return PendingIssueAttachment(
                filename: "image-\(filenameIdentifier).jpg",
                contentType: "image/jpeg",
                data: jpegData
            )
        }
        throw PhotoAttachmentImportError.unsupported(policy.unsupportedMessage)
    }
}

struct AttachmentMessagePayload: Sendable {
    let body: String
    let references: [String]
    let referencesJSON: String
    let files: [MultipartFile]

    init(
        body: String,
        attachments: [PendingIssueAttachment],
        references providedReferences: [String]? = nil,
        referenceGenerator: @Sendable () -> String = {
            UUID().uuidString.lowercased()
        }
    ) throws {
        let generatedReferences = providedReferences ?? attachments.map { _ in referenceGenerator() }
        guard generatedReferences.count == attachments.count else {
            throw PhotoAttachmentImportError.unreadable
        }
        references = generatedReferences
        let markdown = zip(attachments, references).map { attachment, reference in
            Self.markdown(reference: reference, filename: attachment.filename)
        }.joined(separator: "\n\n")
        self.body = [body, markdown].filter { !$0.isEmpty }.joined(separator: "\n\n")
        referencesJSON = String(
            data: try JSONEncoder().encode(references),
            encoding: .utf8
        ) ?? "[]"
        files = attachments.map {
            MultipartFile(
                fieldName: "attachments",
                filename: $0.filename,
                contentType: $0.contentType,
                data: $0.data
            )
        }
    }

    static func markdown(reference: String, filename: String) -> String {
        "![\(markdownAltText(filename))](briar-attachment://\(reference))"
    }

    static func markdownAltText(_ filename: String) -> String {
        var result = ""
        var isInLineBreak = false
        for scalar in filename.unicodeScalars {
            if scalar.value == 10 || scalar.value == 13 {
                if !isInLineBreak { result.append(" ") }
                isInLineBreak = true
                continue
            }
            isInLineBreak = false
            switch scalar {
            case "\\":
                result.append("\\\\")
            case "[":
                result.append("\\[")
            case "]":
                result.append("\\]")
            default:
                result.unicodeScalars.append(scalar)
            }
        }
        return result
    }
}
