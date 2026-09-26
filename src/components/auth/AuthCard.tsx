import Image from "next/image";

/**
 * Brand image framed for the practice sign-in page: hairline, canvas gap, navy line, white mat,
 * hairline, picture. Borders and a hairline shadow only (DESIGN.md §3, §7); the image is
 * decorative (empty alt), so assistive tech skips it and the logo still names the product.
 */
function AuthHero() {
  return (
    <div className="rounded-panel border border-border bg-canvas p-1">
      <div className="rounded-control border border-primary bg-surface p-1.5 shadow-xs">
        <div className="overflow-hidden rounded-sm border border-border bg-surface-muted">
          <Image
            src="/brand/denialdesk-reception.jpg"
            alt=""
            width={2000}
            height={800}
            sizes="(max-width: 1023px) 400px, 600px"
            className="block h-auto w-full"
            priority
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The sign-in card used by practice sign-in and the platform console's own sign-in.
 * With `hero`, wide screens show the framed brand image and a product line beside the card;
 * narrow screens stack the image above the card and drop the line. Without it, the card is alone.
 */
export function AuthCard({
  label,
  hero = false,
  children,
}: {
  label?: string;
  hero?: boolean;
  children: React.ReactNode;
}) {
  return (
    // `my-auto` on the child (not `justify-center` here) keeps the top reachable when the page scrolls.
    <main id="main" className="flex flex-1 flex-col items-center overflow-y-auto bg-canvas px-4 py-10">
      <div className={`my-auto w-full max-w-[400px] ${hero ? "lg:max-w-[1040px]" : ""}`}>
        <div className={hero ? "lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:gap-12" : ""}>
          <div>
            <div className={`mb-8 flex flex-col items-center gap-2 ${hero ? "lg:mb-6 lg:items-start" : ""}`}>
              <Image src="/brand/denialdesk-logo.png" alt="DenialDesk" width={188} height={45} priority />
              {label && (
                <p className="text-label font-semibold tracking-wide text-muted uppercase">{label}</p>
              )}
            </div>
            {hero && (
              <>
                <AuthHero />
                <div className="mt-6 hidden lg:block">
                  <p className="text-title font-semibold text-primary">
                    Claims and denial management for Florida physician practices.
                  </p>
                  <p className="mt-2 max-w-[52ch] text-body text-muted">
                    Classify denials, prioritize by value and deadline, draft appeals, and keep every
                    prompt-pay and appeal clock in view.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className={hero ? "mt-8 lg:mt-0" : ""}>
            <div className="rounded-panel border border-t-4 border-border border-t-primary bg-surface p-8 shadow-xs">
              {children}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-label text-muted">
          Authorized use only. Access to this system is monitored and logged.
        </p>
      </div>
    </main>
  );
}
