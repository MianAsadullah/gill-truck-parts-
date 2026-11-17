import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { QbWindow, QbBanner, QbButton, QbFieldset } from "@/components/qb/Ui";

/**
 * Catch-all for dashboard routes that are designed but not yet built.
 *
 * Next.js resolves static segments before a catch-all, so every implemented
 * route (/dashboard/invoices, /dashboard/invoices/new, ...) still wins. This
 * only catches the rest.
 *
 * It exists so that the menu bar and the home-page workflow diagram can show
 * the complete system — which is the point of the QuickBooks home screen —
 * without any of those links dead-ending on a bare 404. The page names the
 * module, states plainly that it is not implemented, and says what already
 * exists to support it, so nobody mistakes a placeholder for a finished
 * feature.
 */

interface ModuleInfo {
  title: string;
  scope: string;
  foundation: string[];
}

const MODULES: Record<string, ModuleInfo> = {
  "items/adjust": {
    title: "Adjust Quantity on Hand",
    scope: "Physical-count adjustment posting the value difference to shrinkage.",
    foundation: ["Implemented at /dashboard/items/adjust"],
  },
};

export default async function NotBuiltYetPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const root = slug[0] ?? "";
  const info = MODULES[root];
  const path = "/dashboard/" + slug.join("/");

  return (
    <QbWindow
      title="Screen Not Found"
      subtitle={"\u2014 " + path}
      toolbar={
        <Link href="/dashboard">
          <QbButton size="sm">Home</QbButton>
        </Link>
      }
      bodyClassName="bg-qb-chrome"
    >
      <div className="p-3 space-y-3 max-w-[760px]">
        <QbBanner variant="warn" title="There is no screen at this address.">
          <code className="font-qbMono">{path}</code> does not match any window in
          this application. It may be a stale link or a mistyped URL.
          {info ? " " + info.scope : ""}
        </QbBanner>

        <QbFieldset legend="Where to go instead">
          <ul className="text-qb leading-[16px] list-disc pl-4 space-y-[2px]">
            <li>
              <Link href="/dashboard" className="text-qb-blue hover:underline">
                Home
              </Link>{" "}
              &mdash; the workflow diagram links every window the signed-in role can open
            </li>
            <li>
              <Link href="/dashboard/invoices/new" className="text-qb-blue hover:underline">
                Create Invoices
              </Link>
              {", "}
              <Link href="/dashboard/items" className="text-qb-blue hover:underline">
                Item List
              </Link>
              {", "}
              <Link
                href="/dashboard/purchase-orders"
                className="text-qb-blue hover:underline"
              >
                Purchase Orders
              </Link>
              {", "}
              <Link href="/dashboard/reports" className="text-qb-blue hover:underline">
                Reports
              </Link>
            </li>
            <li>
              The menu bar at the top lists every window, grouped the way QuickBooks
              groups them.
            </li>
          </ul>
        </QbFieldset>

        <div className="text-qb-xs text-qb-inkMuted">
          Not every address is a missing feature &mdash; a screen your role may not open
          shows an &ldquo;Access denied&rdquo; notice instead of this page.
        </div>
      </div>
    </QbWindow>
  );
}
