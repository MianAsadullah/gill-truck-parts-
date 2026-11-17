"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "@/server/actions/auth";
import { QbButton, QbField, QbInput, QbBanner } from "@/components/qb/Ui";

/**
 * The QuickBooks "Open Company" sign-in dialog: a small square window,
 * blue title bar, user/password pair, and a hint block. Nothing clever —
 * staff sign in here twenty times a week and it should look identical
 * every time.
 */

function SignInButton() {
  const { pending } = useFormStatus();
  return (
    <QbButton
      type="submit"
      variant="primary"
      disabled={pending}
      className="min-w-[88px]"
    >
      {pending ? "Signing In..." : "OK"}
    </QbButton>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );

  return (
    <div className="qb-window w-full max-w-[420px]">
      <div className="qb-window-title">
        <span>Gill Truck Parts &mdash; Sign In</span>
      </div>

      <form action={formAction} className="bg-qb-chrome">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-start gap-3 pb-4">
            <div
              className="w-[38px] h-[38px] bg-qb-green text-white font-bold
                         text-qb-xl flex items-center justify-center shrink-0
                         border border-qb-greenDark"
              aria-hidden="true"
            >
              GT
            </div>
            <div className="min-w-0">
              <div className="text-qb-lg font-bold leading-tight">
                Gill Truck Parts
              </div>
              <div className="text-qb text-qb-inkMuted">
                Inventory, Counter Sales &amp; Accounting
              </div>
            </div>
          </div>

          {state?.error ? (
            <QbBanner variant="err" className="mb-3">
              {state.error}
            </QbBanner>
          ) : null}

          <div className="space-y-2">
            <QbField label="User Name" htmlFor="email" labelWidth={78}>
              <QbInput
                id="email"
                name="email"
                autoComplete="username"
                autoFocus
                required
                placeholder="initials or e-mail"
              />
            </QbField>
            <QbField label="Password" htmlFor="password" labelWidth={78}>
              <QbInput
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </QbField>
          </div>
        </div>

        <div
          className="border-t border-qb-border px-4 py-2 flex items-center
                     justify-end gap-1"
        >
          <SignInButton />
          <QbButton type="reset">Cancel</QbButton>
        </div>
      </form>

      {/*
        Demo credentials. In a real deployment this block is removed — it is
        here so the three permission tiers can be exercised immediately.
      */}
      <div className="border-t border-qb-border bg-qb-chromeAlt px-4 py-2">
        <div className="qb-fieldset-legend pb-1">Demo Accounts</div>
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>User</th>
              <th style={{ width: "30%" }}>Password</th>
              <th>Sees Cost?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>admin</td>
              <td className="font-qbMono">parts123</td>
              <td className="text-qb-greenDark">Yes</td>
            </tr>
            <tr>
              <td>mgr</td>
              <td className="font-qbMono">parts123</td>
              <td className="text-qb-greenDark">Yes &middot; can approve</td>
            </tr>
            <tr>
              <td>counter</td>
              <td className="font-qbMono">parts123</td>
              <td className="text-qb-red font-bold">No</td>
            </tr>
            <tr>
              <td>acct</td>
              <td className="font-qbMono">parts123</td>
              <td className="text-qb-greenDark">Yes</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
