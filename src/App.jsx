import { useState, useEffect } from "react";
import { AuthProvider } from "./context/AuthContext";
import Header            from "./components/Header";
import ReadyCheckOverlay from "./components/ReadyCheckOverlay";
import Home              from "./pages/Home";
import Auth              from "./pages/Auth";
import Queue             from "./pages/Queue";
import About             from "./pages/About";
import Duel              from "./pages/Duel";
import Leaderboard       from "./pages/Leaderboard";

function useRouter() {
  const getPage = () => {
    const p = window.location.pathname.replace("/","") || "home";
    return ["home","auth","queue","about","duel","leaderboard"].includes(p) ? p : "home";
  };
  const [page, setPage] = useState(getPage);
  const navigate = (to) => {
    window.history.pushState(null,"", to === "home" ? "/" : "/" + to);
    setPage(to);
    window.scrollTo(0,0);
  };
  useEffect(() => {
    const h = () => setPage(getPage());
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  return { page, navigate };
}

function AppInner() {
  const { page, navigate } = useRouter();
  return (
    <>
      <ReadyCheckOverlay navigate={navigate}/>
      {page !== "duel" && <Header navigate={navigate} currentPage={page}/>}
      {page === "home"        && <Home        navigate={navigate}/>}
      {page === "auth"        && <Auth        navigate={navigate}/>}
      {page === "queue"       && <Queue       navigate={navigate}/>}
      {page === "about"       && <About       navigate={navigate}/>}
      {page === "duel"        && <Duel        navigate={navigate}/>}
      {page === "leaderboard" && <Leaderboard navigate={navigate}/>}
    </>
  );
}

export default function App() {
  return <AuthProvider><AppInner/></AuthProvider>;
}