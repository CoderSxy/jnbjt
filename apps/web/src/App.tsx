import { Link, Route, Routes } from 'react-router-dom';
import { KnowledgePage } from './features/knowledge/KnowledgePage';
import { LoginPage } from './features/auth/LoginPage';
import { CitiesPage } from './features/cities/CitiesPage';
import { ProductionPage } from './features/production/ProductionPage';

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          江南百景图规划
        </Link>
        <nav className="nav">
          <Link to="/">资料</Link>
          <Link to="/cities">存档</Link>
          <Link to="/production">生产</Link>
          <Link to="/login">登录</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<KnowledgePage />} />
          <Route path="/buildings/:id" element={<KnowledgePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cities" element={<CitiesPage />} />
          <Route path="/production" element={<ProductionPage />} />
        </Routes>
      </main>
    </div>
  );
}
