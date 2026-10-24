import { Link, Route, Routes } from 'react-router-dom';
import { KnowledgePage } from './features/knowledge/KnowledgePage';

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          江南百景图规划
        </Link>
        <nav>
          <Link to="/">资料</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<KnowledgePage />} />
          <Route path="/buildings/:id" element={<KnowledgePage />} />
        </Routes>
      </main>
    </div>
  );
}
