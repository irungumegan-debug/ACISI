import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Logo } from '../components/Logo';

/**
 * Public header, shown on every public page including signup/login.
 * Transparent over the home hero, solid navy once the page scrolls (and on
 * every other page). Below 860px the links move into a slide-in panel.
 */
export function MarketingLayout() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const overHero = location.pathname === '/' && !scrolled;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // While the menu is open: lock page scroll, close on Escape, focus the panel.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link is-active' : 'nav-link');

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header${overHero ? ' is-transparent' : ''}`}>
        <div className="site-header-inner">
          <Link className="brand-link" to="/" aria-label="ACISI home">
            <Logo />
          </Link>
          <nav className="site-nav" aria-label="Main">
            <NavLink className={navClass} to="/about">
              About
            </NavLink>
            <NavLink className={navClass} to="/contact">
              Contact Us
            </NavLink>
          </nav>
          <div className="site-actions">
            <Link className="btn btn-ghost-light btn-sm" to="/login">
              Login
            </Link>
            <Link className="btn btn-gold btn-sm" to="/signup">
              Sign Up
            </Link>
          </div>
          <button
            ref={menuButton}
            type="button"
            className="menu-toggle"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={24} aria-hidden />
          </button>
        </div>
      </header>

      <div className={`mobile-menu${menuOpen ? ' is-open' : ''}`} aria-hidden={!menuOpen}>
        <button type="button" className="mobile-menu-scrim" tabIndex={-1} aria-label="Close menu" onClick={() => setMenuOpen(false)} />
        <div ref={panel} id="mobile-menu" className="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="mobile-menu-top">
            <Logo size={30} />
            <button type="button" className="menu-toggle is-close" aria-label="Close menu" onClick={() => setMenuOpen(false)} tabIndex={menuOpen ? 0 : -1}>
              <X size={24} aria-hidden />
            </button>
          </div>
          <nav className="mobile-menu-links" aria-label="Mobile">
            {[
              ['/', 'Home'],
              ['/about', 'About'],
              ['/contact', 'Contact Us'],
            ].map(([to, label]) => (
              <NavLink key={to} to={to as string} end className={navClass} tabIndex={menuOpen ? 0 : -1}>
                {label}
                <ArrowRight size={18} aria-hidden />
              </NavLink>
            ))}
          </nav>
          <div className="mobile-menu-actions">
            <Link className="btn btn-ghost-light btn-block" to="/login" tabIndex={menuOpen ? 0 : -1}>
              Login
            </Link>
            <Link className="btn btn-gold btn-block" to="/signup" tabIndex={menuOpen ? 0 : -1}>
              Sign Up
            </Link>
          </div>
          <p className="mobile-menu-motto">Healthcare, within reach.</p>
        </div>
      </div>

      <div id="main">
        <Outlet />
      </div>
    </>
  );
}

/** Fades sections marked `data-reveal` in as they scroll into view (instantly with reduced motion). */
function useRevealOnScroll(dependency: string) {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-visible)'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      elements.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [dependency]);
}

/** Wraps Home/About/Contact with the shared footer — signup/login stay distraction-free without it. */
export function ContentLayout() {
  const location = useLocation();
  useRevealOnScroll(location.pathname);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <Outlet />
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Logo size={36} />
            <p className="footer-motto">Healthcare, within reach.</p>
            <p className="footer-blurb">Check-in, records, prescriptions and payments for small clinics in Kenya, in one place.</p>
          </div>
          <div className="footer-cols">
            <div>
              <p className="footer-heading">ACISI</p>
              <Link to="/about">About</Link>
              <Link to="/contact">Contact Us</Link>
            </div>
            <div>
              <p className="footer-heading">Account</p>
              <Link to="/login">Login</Link>
              <Link to="/signup">Sign Up</Link>
            </div>
            <div>
              <p className="footer-heading">Legal</p>
              <span className="footer-soon">Privacy Policy (coming soon)</span>
              <span className="footer-soon">Terms (coming soon)</span>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="gold-rule" aria-hidden />
          <p>© {new Date().getFullYear()} ACISI. A records and admin system for clinics, not a healthcare provider.</p>
        </div>
      </footer>
    </>
  );
}
