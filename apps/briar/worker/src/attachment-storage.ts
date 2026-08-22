export type StoredAttachmentFile = {
  id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  file: File;
};

export function prepareStoredAttachments<
  Identity extends Pick<StoredAttachmentFile, "id" | "object_key">,
>(
  files: readonly File[],
  identify: (file: File, position: number) => Identity,
): Array<Identity & Omit<StoredAttachmentFile, "id" | "object_key">> {
  return files.map((file, position) => ({
    ...identify(file, position),
    filename: file.name.normalize("NFC").trim(),
    content_type: file.type,
    byte_size: file.size,
    file,
  }));
}

export const contentDisposition = (filename: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;

export async function uploadStoredAttachments(
  bucket: Pick<R2Bucket, "put">,
  attachments: readonly StoredAttachmentFile[],
  uploadedKeys: string[],
  customMetadata: (attachment: StoredAttachmentFile) => Record<string, string>,
) {
  for (const attachment of attachments) {
    // Passing the Blob preserves its known byte length. A derived stream can
    // lose that length marker and R2 rejects unknown-length request bodies.
    await bucket.put(attachment.object_key, attachment.file, {
      httpMetadata: {
        contentType: attachment.content_type,
        contentDisposition: contentDisposition(attachment.filename),
      },
      customMetadata: customMetadata(attachment),
    });
    uploadedKeys.push(attachment.object_key);
  }
}
