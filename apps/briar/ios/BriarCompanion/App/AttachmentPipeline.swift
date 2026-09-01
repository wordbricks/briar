import BriarContracts
import CryptoKit
import Foundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum PreparedUploadPipeline {
    static func metadata(
        attachments: [PendingIssueAttachment],
        clientIDs: [String]
    ) throws -> [BriarTypes_UploadFileMetadata] {
        guard attachments.count == clientIDs.count,
              Set(clientIDs).count == clientIDs.count,
              clientIDs.allSatisfy({ !$0.isEmpty })
        else { throw MobileAPIError.invalidRequest }
        return zip(attachments, clientIDs).map { attachment, clientID in
            var metadata = BriarTypes_UploadFileMetadata()
            metadata.clientID = clientID
            metadata.filename = attachment.filename
            metadata.contentType = attachment.contentType
            metadata.byteSize = UInt64(attachment.data.count)
            metadata.sha256 = Data(SHA256.hash(data: attachment.data))
            return metadata
        }
    }

    static func upload(
        attachments: [PendingIssueAttachment],
        clientIDs: [String],
        preparedUploads: [BriarTypes_PreparedUpload],
        using client: any PreparedUploadClientProtocol
    ) async throws -> [String] {
        guard attachments.count == clientIDs.count,
              preparedUploads.count == attachments.count
        else { throw MobileAPIError.invalidResponse }
        guard Set(preparedUploads.map(\.clientID)).count == preparedUploads.count else {
            throw MobileAPIError.invalidResponse
        }
        let preparedByClientID = Dictionary(
            uniqueKeysWithValues: preparedUploads.map { ($0.clientID, $0) }
        )
        guard preparedByClientID.count == clientIDs.count else {
            throw MobileAPIError.invalidResponse
        }
        var uploadIDs: [String] = []
        for (attachment, clientID) in zip(attachments, clientIDs) {
            guard let prepared = preparedByClientID[clientID],
                  prepared.hasReference,
                  !prepared.reference.uploadID.isEmpty,
                  !prepared.uploadCapability.isEmpty,
                  let uploadURL = URL(string: prepared.uploadURL)
            else { throw MobileAPIError.invalidResponse }
            try await client.putPreparedUpload(
                uploadURL,
                capability: prepared.uploadCapability,
                contentType: attachment.contentType,
                data: attachment.data
            )
            uploadIDs.append(prepared.reference.uploadID)
        }
        return uploadIDs
    }

    static func replacingAttachmentReferences(
        in body: String,
        clientIDs: [String],
        uploadIDs: [String]
    ) throws -> String {
        guard clientIDs.count == uploadIDs.count else {
            throw MobileAPIError.invalidResponse
        }
        return zip(clientIDs, uploadIDs).reduce(body) { result, pair in
            result.replacingOccurrences(
                of: "briar-attachment://\(pair.0)",
                with: "briar-attachment://\(pair.1)"
            )
        }
    }

    static func references(uploadIDs: [String]) throws -> [BriarTypes_UploadReference] {
        guard Set(uploadIDs).count == uploadIDs.count,
              uploadIDs.allSatisfy({ !$0.isEmpty })
        else { throw MobileAPIError.invalidResponse }
        return uploadIDs.map { uploadID in
            var reference = BriarTypes_UploadReference()
            reference.uploadID = uploadID
            return reference
        }
    }
}

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
