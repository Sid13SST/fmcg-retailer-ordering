import { LogoutButton } from "./logout-button";

export function AppHeader({ title, userName }: { title: string; userName: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Kirana OrderDesk</p>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-slate-600 sm:inline">{userName}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
