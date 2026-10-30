"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RiLogoutBoxRLine, RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import Link from "next/link";
import { useUser } from "../context/UserContext";
import { linkHref } from "./authUtil";
import staticNavigation from "./navigation";
import NavWeather from "./NavWeather";
import "./navbar.css";

// ─── Vertical divider between menu items ───────────────────────────────────────
function Divider() {
  return (
    <div className="h-8 w-[0.7px] bg-brand-soft opacity-70 flex-shrink-0" />
  );
}

// ─── Dot separator between sub-menu items ──────────────────────────────────────
function DotSeparator() {
  return <div className="w-1.5 h-1.5 rounded-full bg-neutrals-light/50 flex-shrink-0" />;
}

// ─── Avatar with hover profile card ────────────────────────────────────────────
function AvatarCard({ user, onLogout }) {
  const [showCard, setShowCard] = useState(false);
  const timeoutRef = useRef(null);

  const handleEnter = () => {
    clearTimeout(timeoutRef.current);
    setShowCard(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setShowCard(false), 200);
  };

  const handleExitClick = () => {
    window.close();
    // Fallback if window.close is blocked by browser security
    setTimeout(() => {
      window.location.href = "https://nexus.demo.lon-pcai.twlon.com/";
    }, 150);
  };

  const avatarSrc = user.avatar_url || (user.username ? `/images/users/${user.username}.webp` : "/images/users/default.webp");

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div className="w-12 h-12 rounded-full ring-2 ring-brand-vivid overflow-hidden cursor-pointer">
        <img
          src={avatarSrc}
          alt={`${user.full_first_name || 'User'}'s avatar`}
          className="w-full h-full object-cover"
        />
      </div>

      <AnimatePresence>
        {showCard && (
          <motion.div
            className="absolute left-[52px] top-[60px] z-50 min-w-[300px] rounded-2xl border border-neutrals-dark/50 overflow-hidden"
            style={{
              background: "rgba(18, 18, 18, 0.92)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
            }}
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="p-6 flex items-center gap-5">
              <div className="w-16 h-16 rounded-full ring-2 ring-brand-vivid overflow-hidden flex-shrink-0">
                <img
                  src={avatarSrc}
                  alt={user.full_first_name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="text-white text-[15px] font-semibold tracking-wide truncate">
                  {user.full_first_name} {user.full_surname}
                </p>
                <p className="text-brand-vivid text-[13px] font-normal tracking-wide truncate mt-1">
                  {user.job_title}
                </p>
                <p className="text-neutrals-medium text-xs font-light tracking-wider mt-0.5">
                  {user.base_site}
                </p>
              </div>
            </div>

            <div className="mx-5 h-px bg-neutrals-dark/60" />

            <button
              id="exit-button"
              onClick={handleExitClick}
              className="w-full flex items-center gap-3 px-6 py-4 cursor-pointer
                         bg-transparent border-none outline-none
                         text-neutrals-medium hover:text-brand-vivid
                         transition-colors duration-200 group"
            >
              <RiLogoutBoxRLine className="w-[18px] h-[18px] transition-colors duration-200 group-hover:text-brand-vivid" />
              <span className="text-[13px] font-medium tracking-wider uppercase">
                Exit AI App
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Single menu item ──────────────────────────────────────────────────────────
function NavItem({ item, isActive, onEnter, onLeave }) {
  const content = (
    <motion.span
      className="text-[16px] font-sans font-normal uppercase tracking-[8px] whitespace-nowrap select-none"
      animate={{
        color: isActive === item.id
          ? "#F2561D"            // hovered item → brand vivid
          : isActive
            ? "#474747"          // another item is hovered → dim
            : "#FFFFFF",         // default → white
      }}
      transition={{ duration: 0.25 }}
    >
      {item.label}
    </motion.span>
  );

  if (item.url) {
    return (
      <a
        href={linkHref(item.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline outline-none cursor-pointer"
        onMouseEnter={() => onEnter(item.id)}
        onMouseLeave={onLeave}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className="cursor-pointer bg-transparent border-none outline-none"
      onMouseEnter={() => onEnter(item.id)}
      onMouseLeave={onLeave}
    >
      {content}
    </button>
  );
}

// ─── Sub-menu row (overflow-aware with gradient fade + arrow controls) ─────────
function SubMenu({ departments }) {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const scrollStartX = useRef(0);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflows = el.scrollWidth > el.clientWidth + 2;
    setIsOverflowing(overflows);
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const timer = setTimeout(checkOverflow, 50);
    window.addEventListener("resize", checkOverflow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", checkOverflow);
    };
  }, [checkOverflow, departments]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
        checkOverflow();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [checkOverflow, departments]);

  const scrollBy = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
    setTimeout(checkOverflow, 350);
  };

  const handleMouseDown = (e) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    scrollStartX.current = scrollRef.current?.scrollLeft || 0;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };
  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStartX.current;
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollStartX.current - dx;
      checkOverflow();
    }
  };
  const handleMouseUp = () => {
    isDragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <motion.div
      className="relative w-full"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {canScrollLeft && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-20 z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.85) 0%, transparent 100%)",
            }}
          />
          <button
            aria-label="Scroll left"
            onClick={() => scrollBy(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border-none bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all duration-200"
          >
            <RiArrowLeftSLine size={16} />
          </button>
        </>
      )}

      <div
        ref={scrollRef}
        className={`flex items-center gap-6 py-3 overflow-x-auto overflow-y-hidden ${isOverflowing ? "px-12 cursor-grab" : "px-8 justify-center"
          }`}
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          maxWidth: "100%",
        }}
        onScroll={checkOverflow}
        onMouseDown={isOverflowing ? handleMouseDown : undefined}
      >
        {departments.map((dept, i) => {
          const isObject = typeof dept === "object" && dept !== null;
          const label = isObject ? dept.label : dept;
          const url = isObject ? dept.url : "";
          const id = isObject ? dept.id : `${label}-${i}`;

          const content = (
            <span className="text-[14px] font-sans font-normal uppercase tracking-[7px] text-neutrals-light whitespace-nowrap select-none cursor-pointer hover:text-white transition-colors duration-200">
              {label}
            </span>
          );

          return (
            <div key={id} className="flex items-center gap-6 flex-shrink-0">
              {i > 0 && <DotSeparator />}
              {url ? (
                <a
                  href={linkHref(url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="no-underline outline-none"
                >
                  {content}
                </a>
              ) : (
                content
              )}
            </div>
          );
        })}
      </div>

      {canScrollRight && (
        <>
          <div
            className="absolute right-0 top-0 bottom-0 w-20 z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(to left, rgba(0,0,0,0.85) 0%, transparent 100%)",
            }}
          />
          <button
            aria-label="Scroll right"
            onClick={() => scrollBy(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border-none bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all duration-200"
          >
            <RiArrowRightSLine size={16} />
          </button>
        </>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN NAV BAR COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function NavBar() {
  const { user, loading, logout } = useUser();
  const [navigation, setNavigation] = useState(staticNavigation);
  const [activeMenu, setActiveMenu] = useState(null);
  const menuTimeoutRef = useRef(null);

  // Fetch dynamic navigation options from DB proxy
  useEffect(() => {
    fetch("/api/navigation")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load navigation");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setNavigation(data);
        }
      })
      .catch((err) => {
        console.error("Navigation load failed, using static fallback:", err);
      });
  }, []);

  const handleMenuEnter = (id) => {
    clearTimeout(menuTimeoutRef.current);
    setActiveMenu(id);
  };

  const handleMenuLeave = () => {
    menuTimeoutRef.current = setTimeout(() => setActiveMenu(null), 150);
  };

  const handleSubMenuEnter = () => {
    clearTimeout(menuTimeoutRef.current);
  };

  const activeItem = navigation.find((n) => n.id === activeMenu);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-[45]"
      onMouseLeave={handleMenuLeave}
    >
      {/* ── Main bar ──────────────────────────────────────────────────────── */}
      <div
        className="h-20 flex items-center px-7 gap-8"
        style={{
          background: "rgba(0, 0, 0, 0.35)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {/* Avatar / Login Link */}
        {loading ? (
          <div className="w-12 h-12 rounded-full bg-neutrals-dark/30 animate-pulse flex-shrink-0" />
        ) : user ? (
          <AvatarCard user={user} onLogout={logout} />
        ) : (
          <Link
            href="/"
            className="text-white text-[14px] font-sans font-medium uppercase tracking-[2px] hover:text-brand-vivid transition-colors duration-200 select-none"
          >
            Login
          </Link>
        )}

        {/* Menu items */}
        <div className="flex-1 flex items-center justify-center gap-8">
          {navigation.map((item, i) => (
            <div key={item.id} className="flex items-center gap-8">
              {i > 0 && <Divider />}
              <NavItem
                item={item}
                isActive={activeMenu}
                onEnter={handleMenuEnter}
                onLeave={handleMenuLeave}
              />
            </div>
          ))}
        </div>

        {/* Weather widget — replaces logo, shows weather for user's base site */}
        <NavWeather location={user ? user.base_site : null} />
      </div>

      {/* ── Sub-menu dropdown ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeItem && (
          <motion.div
            className="border-t border-neutrals-medium/30 overflow-hidden"
            style={{
              background: "rgba(0, 0, 0, 0.30)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
            }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            onMouseEnter={handleSubMenuEnter}
            onMouseLeave={handleMenuLeave}
          >
            <SubMenu departments={activeItem.departments} />
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
