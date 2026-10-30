import { Route, Routes } from "react-router-dom";
import { ComingSoon } from "./pages/ComingSoon";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";
import { Profile } from "./pages/Profile";
import { SignIn } from "./pages/SignIn";

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/play/classic" element={<ComingSoon title="Classic" />} />
      <Route path="/play/no-mercy" element={<ComingSoon title="No Mercy" />} />
      <Route path="/play/practice" element={<ComingSoon title="Practice vs bots" />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
