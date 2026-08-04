/* eslint-disable react/prop-types */
import { useEffect } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { withAlpha } from "./PageDecor";
import { Rocket } from "./icons";

// Navy-blue brand accent + header gradient (tweak these to match the logo).
const ACCENT = "#2B3F8F";
const HEADER_GRADIENT = "linear-gradient(135deg, #17224F, #2B3F8F)";

function Check() {
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: "18px",
        height: "18px",
        borderRadius: "999px",
        background: withAlpha(ACCENT, 0.14),
        color: ACCENT,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        fontWeight: 700,
        marginTop: "1px",
      }}
    >
      ✓
    </span>
  );
}

/**
 * App-wide paywall shown when the shop has neither an active subscription nor a
 * saved Free-plan choice. Buying a paid plan redirects (top-level) to Shopify's
 * billing confirmation; choosing Free records the choice and dismisses this.
 */
export default function BillingPaywall({ plans }) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (!data || !data.ok) return;
    if (data.confirmationUrl) {
      // Break out of the embedded iframe to Shopify's billing page.
      // eslint-disable-next-line no-undef
      window.open(data.confirmationUrl, "_top");
    } else {
      // Free plan chosen — re-run the layout loader to dismiss the paywall.
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const submit = (fields) => {
    const formData = new FormData();
    for (const [k, v] of Object.entries(fields)) formData.append(k, v);
    fetcher.submit(formData, { method: "POST", action: "/app/subscribe" });
  };

  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.userErrors ?? [] : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(18,20,28,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: "16px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "20px",
          width: "min(940px, 100%)",
          maxHeight: "94vh",
          overflowY: "auto",
          boxShadow: "0 24px 70px rgba(20,23,40,0.4)",
        }}
      >
        {/* Light gradient header band */}
        <div
          style={{
            background: HEADER_GRADIENT,
            color: "#fff",
            padding: "26px 28px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "52px",
              height: "52px",
              flexShrink: 0,
              borderRadius: "14px",
              background: "rgba(255,255,255,0.18)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Rocket size={28} />
          </span>
          <div style={{ display: "grid", gap: "4px" }}>
            <span style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.15 }}>
              Choose a plan to get started
            </span>
            <span style={{ fontSize: "13.5px", opacity: 0.92 }}>
              Pick a plan to start using Smart Variants Pro — change or cancel any
              time.
            </span>
          </div>
        </div>

        <div style={{ padding: "24px 28px 28px" }}>
          {errors.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <s-banner tone="critical" heading="Couldn't start billing">
                <s-unordered-list>
                  {errors.map((e, i) => (
                    <s-list-item key={i}>{e.message}</s-list-item>
                  ))}
                </s-unordered-list>
              </s-banner>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
              gap: "18px",
            }}
          >
            {plans.map((plan) => {
              const rec = plan.recommended;
              return (
                <div
                  key={plan.id}
                  style={{
                    borderRadius: "14px",
                    padding: "18px 18px 20px",
                    border: `${rec ? 2 : 1}px solid ${rec ? ACCENT : "#e3e3e3"}`,
                    background: rec ? withAlpha(ACCENT, 0.06) : "#fff",
                    boxShadow: rec
                      ? `0 10px 26px ${withAlpha(ACCENT, 0.22)}`
                      : "0 1px 2px rgba(0,0,0,0.04)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <span style={{ fontSize: "17px", fontWeight: 700 }}>
                      {plan.name}
                    </span>
                    {rec && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#fff",
                          padding: "3px 10px",
                          borderRadius: "999px",
                          background: ACCENT,
                        }}
                      >
                        Recommended
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span style={{ fontSize: "26px", fontWeight: 800, color: "#1a1a1f" }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: "13px", color: "#6d7175" }}>
                      {plan.cadence}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: "13px", color: "#42474c" }}>
                    {plan.description}
                  </p>

                  <ul
                    style={{
                      listStyle: "none",
                      margin: "4px 0 0",
                      padding: 0,
                      display: "grid",
                      gap: "8px",
                      flex: 1,
                    }}
                  >
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        style={{
                          display: "flex",
                          gap: "8px",
                          fontSize: "13px",
                          color: "#33383d",
                          lineHeight: 1.35,
                        }}
                      >
                        <Check />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {plan.paid ? (
                    <button
                      type="button"
                      onClick={() => submit({ intent: "subscribe", plan: plan.name })}
                      disabled={busy}
                      style={{
                        width: "100%",
                        appearance: "none",
                        border: "none",
                        cursor: busy ? "default" : "pointer",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 700,
                        padding: "11px 14px",
                        borderRadius: "10px",
                        background: ACCENT,
                        boxShadow: `0 4px 12px ${withAlpha(ACCENT, 0.28)}`,
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {busy ? "Opening billing…" : `Buy ${plan.name}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => submit({ intent: "free" })}
                      disabled={busy}
                      style={{
                        width: "100%",
                        cursor: busy ? "default" : "pointer",
                        color: "#33383d",
                        fontSize: "14px",
                        fontWeight: 600,
                        padding: "11px 14px",
                        borderRadius: "10px",
                        background: "#fff",
                        border: "1px solid #c9cccf",
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      Start on Free plan
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
