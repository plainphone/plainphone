// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../i18n/I18n";

type QrDetector = {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
};
const Detector = (globalThis as typeof globalThis & {
  BarcodeDetector?: new (options: { formats: string[] }) => QrDetector;
}).BarcodeDetector;

function plainphoneLink(url: string): URL | null {
  try {
    const link = new URL(url);
    return link.origin === window.location.origin ? link : null;
  } catch {
    return null;
  }
}

export function ApprovalScanner({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(() => params.get("scan") === "1" && Boolean(Detector));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || !Detector) return;
    let stream: MediaStream | undefined;
    let stopped = false;
    let next: number | undefined;
    async function start() {
      try {
        const detector = new Detector!({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped || !video.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const element = video.current;
        element.srcObject = stream;
        await element.play();
        const scan = async () => {
          if (stopped) return;
          try {
            for (const result of await detector.detect(element)) {
              const link = plainphoneLink(result.rawValue);
              if (!link) continue;
              const params = new URLSearchParams(link.hash.slice(1));
              if ((link.pathname === "/invite/trusted" && params.get("token")?.startsWith("pp_t_")) ||
                  (link.pathname === "/add" && params.get("template")?.startsWith("pp_r_"))) {
                if (!stopped) window.location.assign(link.href);
                return;
              }
              const code = link.pathname === "/approvals" ? params.get("code") : null;
              if (code && !stopped) {
                onCode(code);
                setOpen(false);
                return;
              }
            }
            if (!stopped) next = window.setTimeout(() => void scan(), 250);
          } catch {
            if (!stopped) {
              setFailed(true);
              setOpen(false);
            }
          }
        };
        void scan();
      } catch {
        if (!stopped) {
          setFailed(true);
          setOpen(false);
        }
      }
    }
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(next);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, onCode]);

  if (!Detector) return <p className="help">{t("appr.cameraFallback")}</p>;
  return <div className="stack">
    <div><button type="button" className="btn btn-secondary" onClick={() => {
      setFailed(false);
      setOpen(!open);
    }}>{t(open ? "appr.closeCamera" : "appr.scan")}</button></div>
    {open && <video ref={video} muted playsInline aria-label={t("appr.scan")} style={{ width: "100%", maxWidth: "24rem" }} />}
    {failed && <p className="notice notice-error" role="alert">{t("appr.cameraFallback")}</p>}
  </div>;
}
