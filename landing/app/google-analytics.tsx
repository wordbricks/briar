const defaultMeasurementId = "G-SQDQ3YZ6TL";
const measurementId =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || defaultMeasurementId;
const validMeasurementId = /^G-[A-Z0-9]+$/u.test(measurementId ?? "")
  ? measurementId
  : null;

/** Loads GA4 only when a valid public measurement ID is present at build time. */
export function GoogleAnalytics() {
  if (!validMeasurementId) return null;

  const setup = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config',${JSON.stringify(validMeasurementId)});`;

  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(validMeasurementId)}`}
      />
      <script dangerouslySetInnerHTML={{ __html: setup }} />
    </>
  );
}
