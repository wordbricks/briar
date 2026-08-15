import PhotosUI
import SwiftUI
import UIKit

enum ConversationDatePresentation {
    static func startsNewDay(
        at index: Int,
        in dates: [Date],
        calendar: Calendar = .current
    ) -> Bool {
        guard dates.indices.contains(index) else { return false }
        guard index > dates.startIndex else { return true }
        return !calendar.isDate(dates[index], inSameDayAs: dates[index - 1])
    }

    static func label(
        for date: Date,
        relativeTo referenceDate: Date = Date(),
        locale: CompanionLocale
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.foundationIdentifier)
        let calendar = Calendar.current
        formatter.setLocalizedDateFormatFromTemplate(
            calendar.component(.year, from: date) == calendar.component(.year, from: referenceDate)
                ? "MMMMd"
                : "yMMMMd"
        )
        return formatter.string(from: date)
    }
}

/// Shared, bottom-anchored timeline used by channel and issue conversations.
/// It owns date dividers and scroll behavior while each surface supplies its
/// message-specific actions and proposal cards.
struct ConversationTimeline<Message: Identifiable, RowContent: View>: View
where Message.ID: Hashable {
    let messages: [Message]
    let locale: CompanionLocale
    let accessibilityIdentifier: String
    let timestamp: (Message) -> Date
    let hasEarlierMessages: Bool
    let loadingEarlierMessages: Bool
    let onLoadEarlier: (() async -> Void)?
    let measuresMessageHeightsEagerly: Bool
    let row: (Message) -> RowContent
    @State private var requestedEarlierMessages = false
    @State private var eagerInitialPositionReady = false

    init(
        messages: [Message],
        locale: CompanionLocale,
        accessibilityIdentifier: String,
        timestamp: @escaping (Message) -> Date,
        hasEarlierMessages: Bool = false,
        loadingEarlierMessages: Bool = false,
        onLoadEarlier: (() async -> Void)? = nil,
        measuresMessageHeightsEagerly: Bool = false,
        @ViewBuilder row: @escaping (Message) -> RowContent
    ) {
        self.messages = messages
        self.locale = locale
        self.accessibilityIdentifier = accessibilityIdentifier
        self.timestamp = timestamp
        self.hasEarlierMessages = hasEarlierMessages
        self.loadingEarlierMessages = loadingEarlierMessages
        self.onLoadEarlier = onLoadEarlier
        self.measuresMessageHeightsEagerly = measuresMessageHeightsEagerly
        self.row = row
    }

    private var dates: [Date] { messages.map(timestamp) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                messageStack
                .padding(.bottom, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.last?.id, initial: true) { previous, current in
                guard let current else { return }
                if measuresMessageHeightsEagerly, !eagerInitialPositionReady {
                    Task { @MainActor in
                        await Task.yield()
                        proxy.scrollTo(current, anchor: .bottom)
                        await Task.yield()
                        eagerInitialPositionReady = true
                    }
                    return
                }
                guard previous != current else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(current, anchor: .bottom)
                }
            }
            .onChange(of: messages.first?.id) { previous, current in
                guard let previous, previous != current else { return }
                proxy.scrollTo(previous, anchor: .top)
            }
        }
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    @ViewBuilder
    private var messageStack: some View {
        if measuresMessageHeightsEagerly {
            // Channel history arrives in bounded pages. Measuring the current
            // page before scrolling prevents variable-height rows from leaving
            // the initial offset beyond the rendered content on older iOS.
            VStack(spacing: 0) {
                earlierMessagesBoundary
                messageRows
            }
        } else {
            LazyVStack(spacing: 0) {
                earlierMessagesBoundary
                messageRows
            }
        }
    }

    @ViewBuilder
    private var earlierMessagesBoundary: some View {
        if loadingEarlierMessages {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .accessibilityIdentifier("conversation-earlier-messages-loading")
        } else if hasEarlierMessages {
            if measuresMessageHeightsEagerly {
                Color.clear
                    .frame(height: 1)
                    .background {
                        GeometryReader { geometry in
                            Color.clear
                                .onAppear {
                                    requestEarlierMessagesIfNeeded(
                                        boundaryMaxY: geometry.frame(in: .global).maxY
                                    )
                                }
                                .onChange(of: geometry.frame(in: .global).maxY) { _, maxY in
                                    requestEarlierMessagesIfNeeded(boundaryMaxY: maxY)
                                }
                        }
                    }
                    .accessibilityIdentifier("conversation-earlier-messages-trigger")
            } else {
                Color.clear
                    .frame(height: 1)
                    .onAppear {
                        Task { await onLoadEarlier?() }
                    }
                    .accessibilityIdentifier("conversation-earlier-messages-trigger")
            }
        }
    }

    @ViewBuilder
    private var messageRows: some View {
        ForEach(Array(messages.indices), id: \.self) { index in
            if ConversationDatePresentation.startsNewDay(
                at: index,
                in: dates
            ) {
                ConversationDateDivider(
                    date: timestamp(messages[index]),
                    locale: locale
                )
            }
            row(messages[index])
                .id(messages[index].id)
        }
    }

    private func requestEarlierMessagesIfNeeded(boundaryMaxY: CGFloat) {
        guard
            measuresMessageHeightsEagerly,
            hasEarlierMessages,
            !loadingEarlierMessages,
            !requestedEarlierMessages,
            eagerInitialPositionReady,
            boundaryMaxY >= 0
        else { return }
        requestedEarlierMessages = true
        Task {
            await onLoadEarlier?()
            requestedEarlierMessages = false
        }
    }
}

private struct ConversationDateDivider: View {
    let date: Date
    let locale: CompanionLocale

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(ConversationDatePresentation.label(for: date, locale: locale))
                .font(.headline.weight(.bold))
                .foregroundStyle(.primary)
                .fixedSize()
            Rectangle()
                .fill(Color.secondary.opacity(0.25))
                .frame(height: 0.5)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 5)
        .accessibilityElement(children: .combine)
    }
}

/// Shared author/avatar/time chrome. Message bodies remain supplied by the
/// channel or issue so their proposal and interaction behavior stays explicit.
struct ConversationMessageLayout<Content: View>: View {
    let authorImage: String?
    let profileName: String?
    let authorName: String
    let authorSystemImage: String
    let authorAccessorySystemImage: String?
    let timestamp: Date
    let accessibilityIdentifier: String
    let content: Content

    init(
        authorImage: String?,
        profileName: String?,
        authorName: String,
        authorSystemImage: String,
        authorAccessorySystemImage: String? = nil,
        timestamp: Date,
        accessibilityIdentifier: String,
        @ViewBuilder content: () -> Content
    ) {
        self.authorImage = authorImage
        self.profileName = profileName
        self.authorName = authorName
        self.authorSystemImage = authorSystemImage
        self.authorAccessorySystemImage = authorAccessorySystemImage
        self.timestamp = timestamp
        self.accessibilityIdentifier = accessibilityIdentifier
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            ProfileImageView(
                image: authorImage,
                name: profileName,
                systemImage: authorSystemImage,
                size: 40,
                cornerRadius: 10
            )
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(authorName)
                        .font(.subheadline.weight(.bold))
                        .lineLimit(1)
                    if let authorAccessorySystemImage {
                        Image(systemName: authorAccessorySystemImage)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Text(timestamp, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
        .accessibilityIdentifier(accessibilityIdentifier)
    }
}

struct ConversationComposerAccessibility {
    let attachment: String
    let field: String
    let send: String
    let mentionMenu: String
    let mentionItemPrefix: String
}

@MainActor
final class ConversationComposerSubmissionModel: ObservableObject {
    @Published private(set) var isSubmitting = false

    @discardableResult
    func submit(
        draft: Binding<String>,
        mentions: Binding<[ChannelMentionTarget]>,
        attachments: Binding<[PendingIssueAttachment]>,
        send: @escaping (
            String,
            [ChannelMentionTarget],
            [PendingIssueAttachment]
        ) async -> Bool
    ) -> Task<Void, Never>? {
        guard !isSubmitting else { return nil }

        let submittedDraft = draft.wrappedValue
        let submittedMentions = ChannelMentions.retained(
            in: submittedDraft,
            mentions: mentions.wrappedValue
        )
        let submittedAttachments = attachments.wrappedValue

        isSubmitting = true
        draft.wrappedValue = ""
        mentions.wrappedValue = []
        attachments.wrappedValue = []

        return Task { @MainActor in
            let succeeded = await send(
                submittedDraft,
                submittedMentions,
                submittedAttachments
            )
            if !succeeded,
               draft.wrappedValue.isEmpty,
               mentions.wrappedValue.isEmpty,
               attachments.wrappedValue.isEmpty {
                draft.wrappedValue = submittedDraft
                mentions.wrappedValue = submittedMentions
                attachments.wrappedValue = submittedAttachments
            }
            isSubmitting = false
        }
    }
}

/// Shared channel/issue composer. Draft bindings are cleared optimistically
/// when sending starts and restored together when the send fails.
struct ConversationComposer: View {
    @Binding var draft: String
    @Binding var mentions: [ChannelMentionTarget]
    @Binding var attachments: [PendingIssueAttachment]

    @StateObject private var submission = ConversationComposerSubmissionModel()
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var isLoadingPhotos = false
    @State private var attachmentError: String?

    let sending: Bool
    let candidates: [ChannelMentionTarget]
    let placeholder: String
    let replyLabel: String?
    let allowsImagePaste: Bool
    let locale: CompanionLocale
    let accessibility: ConversationComposerAccessibility
    let cancelReply: (() -> Void)?
    let send: (String, [ChannelMentionTarget], [PendingIssueAttachment]) async -> Bool

    private var suggestions: [ChannelMentionTarget] {
        Array(ChannelMentions.suggestions(in: draft, candidates: candidates).prefix(6))
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !attachments.isEmpty
    }

    private var isSending: Bool {
        sending || submission.isSubmitting
    }

    var body: some View {
        VStack(spacing: 0) {
            if !suggestions.isEmpty {
                suggestionList
            }
            if let replyLabel {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left")
                        .foregroundStyle(.secondary)
                    Text(replyLabel)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Button(action: { cancelReply?() }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.text("답글 취소", locale: locale))
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { attachment in
                            ConversationAttachmentDraft(attachment: attachment) {
                                attachments.removeAll { $0.id == attachment.id }
                                attachmentError = nil
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                }
            }
            if let attachmentError {
                Text(attachmentError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            }
            HStack(spacing: 8) {
                attachmentControl
                TextField(placeholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .lineLimit(1...4)
                    .padding(.vertical, 10)
                    .disabled(isSending)
                    .accessibilityIdentifier(accessibility.field)
                    .onChange(of: draft) { _, body in
                        mentions = ChannelMentions.retained(in: body, mentions: mentions)
                    }
                if canSend || isSending {
                    Button {
                        submission.submit(
                            draft: $draft,
                            mentions: $mentions,
                            attachments: $attachments,
                            send: send
                        )
                    } label: {
                        if isSending {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                                .frame(width: 40, height: 40)
                                .background(.tint, in: Circle())
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(.tint, in: Circle())
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(isSending)
                    .accessibilityLabel(L10n.text("보내기", locale: locale))
                    .accessibilityIdentifier(accessibility.send)
                }
            }
            .padding(6)
            .background(
                .regularMaterial,
                in: RoundedRectangle(cornerRadius: 27, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 27, style: .continuous)
                    .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
            }
            .shadow(color: .black.opacity(0.1), radius: 14, y: 5)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(Color(uiColor: .systemBackground))
        .onChange(of: selectedPhotos) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
    }

    private var suggestionList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(suggestions) { target in
                    Button {
                        draft = ChannelMentions.insert(target, into: draft)
                        if !mentions.contains(where: { $0.id == target.id }) {
                            mentions.append(target)
                        }
                    } label: {
                        HStack(spacing: 10) {
                            ProfileImageView(
                                image: target.image,
                                name: target.label,
                                systemImage: target.kind == .agent ? "cpu" : "person.fill",
                                size: 36
                            )
                            VStack(alignment: .leading, spacing: 1) {
                                Text(target.label)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                                Text("@\(target.handle)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            Text(target.detail)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(accessibility.mentionItemPrefix)-\(target.id)")
                }
            }
            .padding(5)
        }
        .frame(maxHeight: 250)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.12), radius: 12, y: 5)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .accessibilityIdentifier(accessibility.mentionMenu)
    }

    @ViewBuilder
    private var attachmentControl: some View {
        if allowsImagePaste {
            Menu {
                PhotosPicker(
                    selection: $selectedPhotos,
                    maxSelectionCount: maximumSelectionCount,
                    matching: PhotoAttachmentImportPolicy.imagesOnly.pickerFilter,
                    preferredItemEncoding: .compatible
                ) {
                    Label(
                        L10n.text("사진 보관함", locale: locale),
                        systemImage: "photo.on.rectangle"
                    )
                }
                Button {
                    pasteImage()
                } label: {
                    Label(
                        L10n.text("클립보드 이미지 붙여넣기", locale: locale),
                        systemImage: "doc.on.clipboard"
                    )
                }
            } label: {
                Image(systemName: "plus")
                    .font(.title3.weight(.regular))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
                    .background(Color.secondary.opacity(0.11), in: Circle())
                    .contentShape(Circle())
            }
            .disabled(
                isLoadingPhotos || isSending ||
                    attachments.count >= PendingIssueAttachment.maximumCount
            )
            .accessibilityLabel(L10n.text("이미지 첨부", locale: locale))
            .accessibilityIdentifier(accessibility.attachment)
        } else {
            PhotosPicker(
                selection: $selectedPhotos,
                maxSelectionCount: maximumSelectionCount,
                matching: PhotoAttachmentImportPolicy.imagesOnly.pickerFilter,
                preferredItemEncoding: .compatible
            ) {
                Image(systemName: "plus")
                    .font(.title3.weight(.regular))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
                    .background(Color.secondary.opacity(0.11), in: Circle())
                    .contentShape(Circle())
            }
            .disabled(
                isLoadingPhotos || isSending ||
                    attachments.count >= PendingIssueAttachment.maximumCount
            )
            .accessibilityLabel(L10n.text("이미지 첨부", locale: locale))
            .accessibilityIdentifier(accessibility.attachment)
        }
    }

    private var maximumSelectionCount: Int {
        max(1, PendingIssueAttachment.maximumCount - attachments.count)
    }

    @MainActor
    private func importPhotos(_ items: [PhotosPickerItem]) async {
        isLoadingPhotos = true
        defer {
            isLoadingPhotos = false
            selectedPhotos = []
        }
        do {
            attachments = try await PhotoAttachmentImporter.importItems(
                items,
                appendingTo: attachments,
                policy: .imagesOnly
            )
            attachmentError = nil
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    @MainActor
    private func pasteImage() {
        guard let image = UIPasteboard.general.image,
              let data = image.jpegData(compressionQuality: 0.82) else {
            attachmentError = L10n.text(
                "클립보드에서 붙여넣을 이미지를 읽지 못했습니다.",
                locale: locale
            )
            return
        }
        let next = attachments + [PendingIssueAttachment(
            filename: "clipboard-\(UUID().uuidString.lowercased()).jpg",
            contentType: "image/jpeg",
            data: data
        )]
        if let message = PendingIssueAttachment.validationMessage(for: next) {
            attachmentError = message
            return
        }
        attachments = next
        attachmentError = nil
    }
}

private struct ConversationAttachmentDraft: View {
    let attachment: PendingIssueAttachment
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            if let image = UIImage(data: attachment.data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image(systemName: "photo")
                    .frame(width: 34, height: 34)
                    .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
            }
            Text(attachment.filename)
                .lineLimit(1)
                .font(.caption)
            Button(role: .destructive, action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.text("첨부 삭제"))
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}
