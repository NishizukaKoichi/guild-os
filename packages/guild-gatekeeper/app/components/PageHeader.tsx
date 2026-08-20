export function PageHeader({ title, subtitle, action }: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 data-page-title>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}
