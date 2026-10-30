"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { fetchSession, logout as endSession } from "../nexus-core/authUtil";

const UserContext = createContext();

const MOCK_USER = {
  user_id: "USR_016",
  username: "richard",
  given_name: "Richard",
  full_first_name: "Richard",
  full_surname: "Husband",
  email: "richard@nxsgi.co.uk",
  job_title: "Logistics Director",
  base_site_id: "SITE_007",
  base_site: "Frankfurt",
  avatar_url: "/images/users/richard.webp",
};

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUserWithSite = async (sessionUser) => {
    if (!sessionUser) {
      setUser(MOCK_USER);
      setLoading(false);
      return;
    }
    if (sessionUser.base_site) {
      setUser(sessionUser);
      setLoading(false);
      return;
    }

    if (sessionUser.base_site_id) {
      try {
        const res = await fetch(`/api/sites?id=${encodeURIComponent(sessionUser.base_site_id)}`);
        if (res.ok) {
          const data = await res.json();
          setUser({
            ...sessionUser,
            base_site: data.city || sessionUser.base_site_id
          });
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error("Failed to dynamically load site details:", error);
      }
    }
    
    setUser(sessionUser);
    setLoading(false);
  };

  // Session from the Nexus gateway (/api/me). Without one (standalone or development runs),
  // loadUserWithSite falls back to MOCK_USER.
  useEffect(() => {
    let cancelled = false;
    fetchSession().then((sessionUser) => {
      if (!cancelled) loadUserWithSite(sessionUser);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = () => {
    setUser(null);
    endSession();
  };

  return (
    <UserContext.Provider value={{ user, loading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
