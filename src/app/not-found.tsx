import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="max-w-sm text-center">
        <h1 className="m-0 text-2xl">Not found</h1>
        <p className="mt-2 text-sm text-mute">That page does not exist, or you no longer have access to it.</p>
        <p className="mt-4 text-sm">
          <Link href="/dashboard" className="fw-s">
            Go to the dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
