import { useState } from "react";
import { Globe2 } from "lucide-react";

export function BrowserTabIcon({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && url !== failed && /^(https?:\/\/|data:image\/)/i.test(url) ? (
    <img
      alt=""
      className="h-3.5 w-3.5 shrink-0 object-contain"
      onError={() => setFailed(url)}
      referrerPolicy="no-referrer"
      src={url}
    />
  ) : (
    <Globe2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
  );
}
