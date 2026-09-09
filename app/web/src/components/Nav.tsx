import { NavLink } from 'react-router-dom';

export function Nav() {
  return (
    <nav className="app-nav">
      <span className="app-nav__brand">Bundle Studio</span>
      <NavLink to="/" end className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>
        Dashboard
      </NavLink>
      <NavLink
        to="/bundles"
        className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}
      >
        Bundles
      </NavLink>
    </nav>
  );
}
