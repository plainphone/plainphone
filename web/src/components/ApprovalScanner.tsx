// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../i18n/I18n";

function plainphoneLink(url: string): URL | null {
  try {
    const link = new URL(url);
    return link.origin === window.location.origin ? link : null;
  } catch {
    return null;
  }
}

type ScanHandlers =
  | { onCode: (code: string) => void; onTemplate?: never }
  | { onTemplate: (template: string) => void; onCode?: never };

export function ApprovalScanner({ onCode, onTemplate }: ScanHandlers) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(() => params.get("scan") === "1" || Boolean(onTemplate));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let stopped = false;
    let next: number | undefined;

    async function start() {
      try {
        const { default: decode } = await import("jsqr");
        if (stopped) return;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped || !video.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const element = video.current;
        element.srcObject = stream;
        await element.play();
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("could not read camera frames");
        const scan = () => {
          if (stopped) return;
          try {
            const scale = Math.min(1, 720 / Math.max(element.videoWidth, element.videoHeight));
            const width = Math.round(element.videoWidth * scale);
            const height = Math.round(element.videoHeight * scale);
            if (width && height) {
              if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
              }
              context.drawImage(element, 0, 0, width, height);
              const frame = context.getImageData(0, 0, width, height);
              const result = decode(frame.data, width, height, { inversionAttempts: "dontInvert" });
              const link = result && plainphoneLink(result.data);
              if (link) {
                const fields = new URLSearchParams(link.hash.slice(1));
                const template = link.pathname === "/add" ? fields.get("template") : null;
                if (template?.startsWith("pp_r_")) {
                  if (onTemplate) onTemplate(template);
                  else window.location.assign(link.href);
                  setOpen(false);
                  return;
                }
                if (onCode) {
                  if (link.pathname === "/invite/trusted" && fields.get("token")?.startsWith("pp_t_")) {
                    window.location.assign(link.href);
                    setOpen(false);
                    return;
                  }
                  const code = link.pathname === "/approvals" ? fields.get("code") : null;
                  if (code) {
                    onCode(code);
                    setOpen(false);
                    return;
                  }
                }
              }
            }
            next = window.setTimeout(scan, 250);
          } catch {
            setFailed(true);
            setOpen(false);
          }
        };
        scan();
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
  }, [open, onCode, onTemplate]);

  return <div className="stack">
    <div><button type="button" className="btn btn-secondary" onClick={() => {
      setFailed(false);
      setOpen(!open);
    }}>{t(open ? "appr.closeCamera" : "appr.scan")}</button></div>
    {open && <video ref={video} muted playsInline aria-label={t("appr.scan")} style={{ width: "100%", maxWidth: "24rem" }} />}
    {failed && <p className="notice notice-error" role="alert">{t("appr.cameraFallback")}</p>}
  </div>;
}
