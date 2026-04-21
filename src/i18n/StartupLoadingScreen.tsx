import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";

export function StartupLoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at top, rgba(132, 204, 22, 0.12), transparent 32%), linear-gradient(180deg, #f8fafc 0%, #ffffff 52%, #f8fafc 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "min(320px, calc(100vw - 48px))",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          textAlign: "center",
        }}
      >
        <img
          src={LIME_BRAND_LOGO_SRC}
          alt={LIME_BRAND_NAME}
          style={{
            width: "96px",
            height: "96px",
            objectFit: "contain",
            filter: "drop-shadow(0 14px 28px rgba(15, 23, 42, 0.12))",
          }}
        />
        <div
          style={{
            fontSize: "18px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#0f172a",
          }}
        >
          正在启动 {LIME_BRAND_NAME}
        </div>
        <div
          style={{
            fontSize: "13px",
            lineHeight: 1.6,
            color: "#64748b",
          }}
        >
          正在准备语言配置与工作台入口，请稍候。
        </div>
      </div>
    </div>
  );
}
