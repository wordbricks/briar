export const contentDisposition = (filename: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;
