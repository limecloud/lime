import { useEffect, useState } from "react";
import {
  readBrowserAutofillEnabled,
  setBrowserAutofillEnabled,
} from "@/lib/api/browserAutofill";
import { BrowserSettingsSwitch } from "./BrowserSettingsFields";

export function BrowserAutofillToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    void readBrowserAutofillEnabled()
      .then((value) => {
        if (alive) setEnabled(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <BrowserSettingsSwitch
      id="browser-autofill"
      checked={enabled}
      disabled={false}
      onChange={(next) => {
        setEnabled(next);
        void setBrowserAutofillEnabled(next).catch(() => setEnabled(!next));
      }}
    />
  );
}
