import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main"
      className="flex flex-1 flex-col items-center justify-center overflow-y-auto bg-canvas px-4 py-12"
    >
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Image src="/brand/denialdesk-logo.png" alt="DenialDesk" width={188} height={45} priority />
        </div>
        <div className="rounded-panel border border-t-4 border-border border-t-primary bg-surface p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-label text-muted">
          Authorized use only. Access to this system is monitored and logged.
        </p>
      </div>
    </main>
  );
}
