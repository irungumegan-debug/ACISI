import { Link, Outlet } from 'react-router-dom';

/** Header nav is sticky across every public page, including signup/login — matches the reference, where only the footer is landing/about/contact-only. */
export function MarketingLayout() {
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link className="nav-brand" to="/">
            ACISI
          </Link>
          <nav className="nav-links">
            <Link to="/about">About</Link>
            <Link to="/contact">Contact us</Link>
            <Link className="nav-secondary" to="/login">
              Login
            </Link>
            <Link className="nav-cta" to="/signup">
              Sign up
            </Link>
          </nav>
        </div>
      </header>
      <Outlet />
    </>
  );
}

/** Wraps Home/About/Contact with the shared footer — signup/login stay distraction-free without it. */
export function ContentLayout() {
  return (
    <>
      <Outlet />
      <footer>
        <div className="footer-inner">
          <Link className="nav-brand" to="/">
            ACISI
          </Link>
          <div className="footer-links">
            <Link to="/about">About</Link>
            <Link to="/contact">Contact us</Link>
            <Link to="/login">Login</Link>
            <Link to="/signup">Sign up</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
