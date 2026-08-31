export type LocalUploadFile = {
  clientId: string;
  file: File;
};

export type PreparedUpload = {
  clientId: string;
  uploadUrl: string;
  uploadCapability: string;
};

export async function uploadPreparedFiles<Upload extends PreparedUpload>(input: {
  apiUrl: string;
  files: readonly LocalUploadFile[];
  uploads: readonly Upload[];
  uploadId: (upload: Upload) => string | undefined;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}) {
  if (input.uploads.length !== input.files.length) {
    throw new Error("Upload prepare returned the wrong file count");
  }
  const uploads = new Map(
    input.uploads.map((upload) => [upload.clientId, upload]),
  );
  if (uploads.size !== input.files.length) {
    throw new Error("Upload prepare returned duplicate client IDs");
  }
  const fetch = input.fetch ?? globalThis.fetch;
  const apiOrigin = new URL(input.apiUrl).origin;
  const uploadIds: string[] = [];
  for (const { clientId, file } of input.files) {
    const upload = uploads.get(clientId);
    const uploadId = upload && input.uploadId(upload);
    if (!upload || !uploadId || !upload.uploadCapability || !upload.uploadUrl) {
      throw new Error("Upload prepare returned an incomplete upload");
    }
    const uploadUrl = new URL(upload.uploadUrl);
    if (uploadUrl.origin !== apiOrigin) {
      throw new Error("Upload prepare returned an unsafe upload URL");
    }
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${upload.uploadCapability}`,
        "Content-Type": file.type,
      },
      body: file,
      signal: input.signal,
    });
    if (response.status !== 204) {
      throw new Error(`File upload failed (${response.status})`);
    }
    uploadIds.push(uploadId);
  }
  return uploadIds;
}
