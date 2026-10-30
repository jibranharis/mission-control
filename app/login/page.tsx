export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <form method="post" action="/api/login">
        <div className="brand">MISSION CONTROL</div>
        <label htmlFor="password" className="label">
          PASSWORD
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
        {error && <p className="error">THAT PASSWORD DIDN&apos;T MATCH</p>}
        <button className="btn btn-primary" type="submit">
          SIGN IN
        </button>
      </form>
    </main>
  );
}
