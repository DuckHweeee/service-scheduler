import { NavLink, useLocation } from 'react-router-dom';
import { useCustomer } from '../api/hooks.js';
import { CUSTOMER_ID } from '../config.js';
import styles from './Header.module.css';

const NAV = [
  { to: '/book', label: 'Book service' },
  { to: '/appointments', label: 'My appointments' },
  { to: '/board', label: 'Service board' },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join('');

export function Header() {
  const { search } = useLocation();
  const customer = useCustomer(CUSTOMER_ID);
  const name = customer.data?.fullName ?? 'Linh Tran';
  // Keep `?mock=` scenario switches while navigating.
  const mock = new URLSearchParams(search).get('mock');
  const keep = mock ? `?mock=${encodeURIComponent(mock)}` : '';

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span aria-hidden="true" className={styles.logo}>
            <span />
            <span />
            <span />
            <span className={styles.logoAccent} />
          </span>
          <span className={styles.title}>Unified Service Scheduler</span>
        </div>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={{ pathname: item.to, search: keep }}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.user}>
          <span aria-hidden="true" className={styles.avatar}>
            {initials(name)}
          </span>
          <span>{name}</span>
        </div>
      </div>
    </header>
  );
}
