import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Header } from './components/Header.js';
import { BookScreen } from './screens/book/BookScreen.js';
import { BoardScreen } from './screens/board/index.js';
import { AppointmentsScreen } from './screens/list/index.js';
import { RecordScreen } from './screens/record/index.js';
import { RescheduleScreen } from './screens/reschedule/index.js';

function Layout() {
  const { pathname } = useLocation();
  return (
    <>
      <Header />
      <ErrorBoundary key={pathname}>
        <Outlet />
      </ErrorBoundary>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/book" replace />} />
        <Route path="/book" element={<BookScreen />} />
        <Route path="/appointments" element={<AppointmentsScreen />} />
        <Route path="/appointments/:reference" element={<RecordScreen />} />
        <Route path="/appointments/:reference/reschedule" element={<RescheduleScreen />} />
        <Route path="/board" element={<BoardScreen />} />
        <Route path="*" element={<Navigate to="/book" replace />} />
      </Route>
    </Routes>
  );
}
