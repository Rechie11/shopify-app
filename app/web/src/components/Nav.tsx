import { NavLink } from 'react-router-dom';

function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="1.5" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="7.5" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="9.5" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function BundlesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 14 4.5V11.5L8 14.5 2 11.5V4.5L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M2 4.5 8 7.5 14 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 7.5V14.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function Nav() {
  return (
    <nav className="app-nav">
      <span className="app-nav__brand">Bundle Studio</span>
      <NavLink to="/" end className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>
        <DashboardIcon />
        Dashboard
      </NavLink>
      <NavLink
        to="/bundles"
        className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}
      >
        <BundlesIcon />
        Bundles
      </NavLink>
    </nav>
  );
}
