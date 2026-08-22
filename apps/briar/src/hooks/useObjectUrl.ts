import { useEffect, useState } from "react";

export type ObjectUrlLoader = () => Blob | Promise<Blob>;

export function useObjectUrl(loader: ObjectUrlLoader | null) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    if (!loader) return;

    const useBlob = (blob: Blob) => {
      if (!active) return;
      try {
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch {
        setFailed(true);
      }
    };
    const fail = () => {
      if (active) setFailed(true);
    };

    try {
      const blob = loader();
      if (blob instanceof Blob) useBlob(blob);
      else void blob.then(useBlob, fail);
    } catch {
      fail();
    }

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [loader]);

  return { source, failed };
}
