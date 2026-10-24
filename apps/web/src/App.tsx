import { Link, Route, Routes } from 'react-router-dom';
import { KnowledgePage } from './features/knowledge/KnowledgePage';
import { LoginPage } from './features/auth/LoginPage';
import { CitiesPage } from './features/cities/CitiesPage';
import { ProductionPage } from './features/production/ProductionPage';
import { MapEditor } from './features/editor/MapEditor';
import { AssistantPage } from './features/assistant/AssistantPage';
import { UploadPage } from './features/imports/UploadPage';
import { RecognitionReview } from './features/imports/RecognitionReview';

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
          <Link to="/editor">地图</Link>
          <Link to="/assistant">助手</Link>
          <Link to="/imports">截图</Link>
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
          <Route path="/editor" element={<MapEditor />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/imports" element={<UploadPage />} />
          <Route path="/imports/review/:id" element={<RecognitionReview />} />
        </Routes>
      </main>
    </div>
  );
}
