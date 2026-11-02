export function LogoutButton({ label = "Log out" }: { label?: string }) {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className="min-h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-100"
      >
        {label}
      </button>
    </form>
  );
}
