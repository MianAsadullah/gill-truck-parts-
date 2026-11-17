import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign In — Gill Truck Parts" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#1C3B52] p-4">
      <LoginForm />
    </div>
  );
}
