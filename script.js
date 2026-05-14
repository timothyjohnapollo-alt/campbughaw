/* =========================================================================
   Camp Bughaw — script.js
   Handles:
     - Navigation behavior + mobile drawer
     - Scroll-reveal animations
     - Booking form validation
     - Real-time availability check against Google Apps Script Web App
     - Submitting reservations to Google Sheets
     - Confirmation emails via EmailJS (to customer + admin)
     - Success modal + error toast
   ========================================================================= */

/* =========================================================================
   STEP 1 — CONFIGURE THESE THREE VALUES BEFORE GOING LIVE
   See README at the bottom of this file (or the setup guide) for how to
   obtain each one.
   ========================================================================= */
const CONFIG = {
  // Your deployed Google Apps Script Web App URL
  // (Looks like: https://script.google.com/macros/s/AKfycb.../exec)
  GAS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbwj7VJkZe0RfFKPs8RB4xQk5JhXxO0HagE3-qYLn80NDUbwLNtINaTdziqQtYa6EJzSzg/exec",

  // EmailJS credentials (https://www.emailjs.com)
  EMAILJS_PUBLIC_KEY:        "B8nKSWre_H4OcdPKq",
  EMAILJS_SERVICE_ID:        "service_1ayvfrp",
  EMAILJS_CUSTOMER_TEMPLATE: "template_qzs7jk1",
  EMAILJS_ADMIN_TEMPLATE:    "template_zymuvci",

  // Where admin notifications should go
  ADMIN_EMAIL: "timothylaurente05@gmail.com",
};

/* ---------- Init EmailJS once on load ---------- */
(function initEmailJS() {
  if (window.emailjs && CONFIG.EMAILJS_PUBLIC_KEY && !CONFIG.EMAILJS_PUBLIC_KEY.includes("REPLACE_ME")) {
    emailjs.init({ publicKey: CONFIG.EMAILJS_PUBLIC_KEY });
  }
})();

/* =========================================================================
   UI: navigation
   ========================================================================= */
const nav        = document.getElementById("nav");
const navToggle  = document.getElementById("navToggle");
const navLinks   = document.querySelector(".nav-links");

// Add a 'scrolled' class to the nav once the user scrolls past the hero edge
const onScroll = () => {
  if (window.scrollY > 40) nav.classList.add("scrolled");
  else nav.classList.remove("scrolled");
};
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Mobile menu toggle
navToggle?.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  navToggle.classList.toggle("open", open);
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
});

// Close drawer on link click
navLinks?.querySelectorAll("a").forEach(a => {
  a.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

/* =========================================================================
   UI: scroll reveal (IntersectionObserver)
   ========================================================================= */
const revealEls = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach(el => io.observe(el));
} else {
  // Fallback: just show them
  revealEls.forEach(el => el.classList.add("in"));
}

/* =========================================================================
   UI: package "Book this stay" buttons → fill the form
   ========================================================================= */
document.querySelectorAll("[data-pkg]").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const pkg = btn.getAttribute("data-pkg");
    const select = document.getElementById("pkg");
    if (select) {
      // Wait until smooth-scroll completes to set the value & focus
      setTimeout(() => {
        select.value = pkg;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, 400);
    }
  });
});

/* =========================================================================
   Footer year
   ========================================================================= */
document.getElementById("year").textContent = new Date().getFullYear();

/* =========================================================================
   BOOKING FORM
   ========================================================================= */
const form         = document.getElementById("bookingForm");
const submitBtn    = document.getElementById("submitBtn");
const availability = document.getElementById("availability");
const successModal = document.getElementById("successModal");
const closeModal   = document.getElementById("closeModal");
const toast        = document.getElementById("toast");

const checkinInput  = document.getElementById("checkin");
const checkoutInput = document.getElementById("checkout");

// Default check-in to today, check-out to tomorrow as a helpful starting point
(function setDateDefaults() {
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  checkinInput.min  = fmt(today);
  checkoutInput.min = fmt(tomorrow);
})();

// When check-in changes, ensure check-out is always after
checkinInput.addEventListener("change", () => {
  if (!checkinInput.value) return;
  const ci = new Date(checkinInput.value);
  const next = new Date(ci); next.setDate(ci.getDate() + 1);
  const min = next.toISOString().slice(0, 10);
  checkoutInput.min = min;
  if (!checkoutInput.value || new Date(checkoutInput.value) <= ci) {
    checkoutInput.value = min;
  }
  scheduleAvailabilityCheck();
});
checkoutInput.addEventListener("change", scheduleAvailabilityCheck);
document.getElementById("pkg").addEventListener("change", scheduleAvailabilityCheck);

/* ---------- Validation helpers ---------- */
const validators = {
  fullName: (v) => v.trim().length >= 2 || "Please enter your full name.",
  email:    (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Please enter a valid email.",
  phone:    (v) => v.replace(/\D/g, "").length >= 7 || "Please enter a valid phone number.",
  guests:   (v) => (Number(v) >= 1 && Number(v) <= 20) || "Guests must be between 1 and 20.",
  checkin:  (v) => !!v || "Choose a check-in date.",
  checkout: (v) => !!v || "Choose a check-out date.",
  pkg:      (v) => !!v || "Select a package.",
};

function setError(name, message) {
  const field = document.querySelector(`[name="${name}"]`)?.closest(".field");
  const err   = document.querySelector(`[data-err-for="${name}"]`);
  if (!field || !err) return;
  if (message === true) {
    field.classList.remove("invalid");
    err.textContent = "";
  } else {
    field.classList.add("invalid");
    err.textContent = message;
  }
}

function validateField(name, value) {
  const fn = validators[name];
  if (!fn) return true;
  const result = fn(value);
  setError(name, result);
  return result === true;
}

// Validate on blur for nicer UX
Object.keys(validators).forEach(name => {
  const el = document.querySelector(`[name="${name}"]`);
  el?.addEventListener("blur", () => validateField(name, el.value));
  el?.addEventListener("input", () => {
    // Clear error as user types
    if (el.closest(".field").classList.contains("invalid")) {
      validateField(name, el.value);
    }
  });
});

// Date-range sanity check
function validateDates() {
  const ci = new Date(checkinInput.value);
  const co = new Date(checkoutInput.value);
  if (checkinInput.value && checkoutInput.value && co <= ci) {
    setError("checkout", "Check-out must be after check-in.");
    return false;
  }
  return true;
}

/* =========================================================================
   AVAILABILITY CHECK
   - Debounced: fires shortly after the user finishes choosing dates/package.
   - Asks the Apps Script web app: are these dates overlapping any existing
     CONFIRMED/PENDING bookings for the same package?
   ========================================================================= */
let availTimer = null;
function scheduleAvailabilityCheck() {
  clearTimeout(availTimer);
  availTimer = setTimeout(runAvailabilityCheck, 350);
}

async function runAvailabilityCheck() {
  const ci = checkinInput.value;
  const co = checkoutInput.value;
  const pkg = document.getElementById("pkg").value;
  if (!ci || !co || !pkg) {
    availability.textContent = "";
    availability.className = "availability";
    return;
  }
  if (new Date(co) <= new Date(ci)) {
    availability.textContent = "Check-out must be after check-in.";
    availability.className = "availability is-bad";
    return;
  }

  availability.textContent = "Checking availability…";
  availability.className = "availability is-loading";

  try {
    const data = await checkAvailability({ checkin: ci, checkout: co, pkg });
    if (data.available) {
      availability.textContent = "✓ These dates are available.";
      availability.className = "availability is-ok";
    } else {
      availability.textContent = "Selected dates are unavailable.";
      availability.className = "availability is-bad";
    }
  } catch (err) {
    // If the GAS URL isn't configured yet, fail quietly so dev can still test layout
    console.warn("Availability check failed:", err);
    availability.textContent = "Couldn’t verify availability right now — please try again.";
    availability.className = "availability is-bad";
  }
}

/* ---- Network call: availability ----
   GET <GAS_URL>?action=check&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&pkg=...
   Response: { available: boolean }
*/
async function checkAvailability({ checkin, checkout, pkg }) {
  const url = new URL(CONFIG.GAS_WEBAPP_URL);
  url.searchParams.set("action", "check");
  url.searchParams.set("checkin", checkin);
  url.searchParams.set("checkout", checkout);
  url.searchParams.set("pkg", pkg);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error("Network error");
  return await res.json();
}

/* ---- Network call: save reservation ----
   POST <GAS_URL>  body: x-www-form-urlencoded with all fields + action=book
   Response: { success: true, reservationId } OR { success: false, reason }
   NOTE: We use form-encoded body to avoid CORS preflight (Apps Script
   handles JSON poorly across origins). Apps Script reads e.parameter.
*/
async function saveReservation(payload) {
  const body = new URLSearchParams({ action: "book", ...payload });

  const res = await fetch(CONFIG.GAS_WEBAPP_URL, {
    method: "POST",
    body,
  });
  if (!res.ok) throw new Error("Network error");
  return await res.json();
}

/* =========================================================================
   FORM SUBMIT
   ========================================================================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // 1. Validate every field
  const data = Object.fromEntries(new FormData(form).entries());
  let allOk = true;
  Object.keys(validators).forEach(name => {
    const ok = validateField(name, data[name] ?? "");
    if (!ok) allOk = false;
  });
  if (!validateDates()) allOk = false;
  if (!allOk) {
    showToast("Please fix the highlighted fields.");
    return;
  }

  // 2. Ask the backend whether these dates are still available
  setLoading(true);
  try {
    const avail = await checkAvailability({
      checkin: data.checkin,
      checkout: data.checkout,
      pkg: data.pkg,
    });

    if (!avail.available) {
      availability.textContent = "Selected dates are unavailable.";
      availability.className = "availability is-bad";
      showToast("Those dates just got booked — please pick another range.");
      setLoading(false);
      return;
    }

    // 3. Save to Google Sheets
    const result = await saveReservation({
      fullName: data.fullName,
      email:    data.email,
      phone:    data.phone,
      guests:   data.guests,
      checkin:  data.checkin,
      checkout: data.checkout,
      pkg:      data.pkg,
      notes:    data.notes || "",
    });

    if (!result.success) {
      // Race-condition catch: server-side double-book guard rejected
      const msg = result.reason === "unavailable"
        ? "Those dates just got booked — please pick another range."
        : "We couldn’t save your booking. Please try again.";
      showToast(msg);
      setLoading(false);
      return;
    }

    // 4. Send confirmation emails via EmailJS (fire-and-forget, don't block UX)
    sendEmails(data).catch(err => console.warn("EmailJS failed:", err));

    // 5. Success!
    openModal();
    form.reset();
    availability.textContent = "";
    availability.className = "availability";
  } catch (err) {
    console.error(err);
    showToast("Something went wrong. Please try again in a moment.");
  } finally {
    setLoading(false);
  }
});

/* =========================================================================
   EMAILJS — sends two emails:
     1) Customer confirmation
     2) Admin notification (to the resort owner)
   ========================================================================= */
async function sendEmails(data) {
  // If EmailJS isn't configured, skip silently
  if (!window.emailjs ||
      !CONFIG.EMAILJS_SERVICE_ID ||
      CONFIG.EMAILJS_SERVICE_ID.includes("REPLACE_ME")) {
    console.info("EmailJS not configured — skipping emails.");
    return;
  }

  const nights = nightsBetween(data.checkin, data.checkout);

  // Common template params — name these EXACTLY in your EmailJS templates
  const params = {
    full_name:    data.fullName,
    email:        data.email,
    phone:        data.phone,
    guests:       data.guests,
    checkin:      formatDate(data.checkin),
    checkout:     formatDate(data.checkout),
    nights:       nights,
    package:      data.pkg,
    notes:        data.notes || "—",
    admin_email:  CONFIG.ADMIN_EMAIL,
    // Both templates use {{to_email}} in the EmailJS "To Email" field
    to_email:     data.email,
  };

  // Customer email
  await emailjs.send(
    CONFIG.EMAILJS_SERVICE_ID,
    CONFIG.EMAILJS_CUSTOMER_TEMPLATE,
    params
  );

  // Admin email — override to_email
  await emailjs.send(
    CONFIG.EMAILJS_SERVICE_ID,
    CONFIG.EMAILJS_ADMIN_TEMPLATE,
    { ...params, to_email: CONFIG.ADMIN_EMAIL }
  );
}

/* =========================================================================
   Small helpers
   ========================================================================= */
function setLoading(on) {
  submitBtn.classList.toggle("loading", on);
  submitBtn.disabled = on;
}

function nightsBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function openModal() {
  successModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeSuccess() {
  successModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
closeModal?.addEventListener("click", closeSuccess);
successModal?.addEventListener("click", (e) => {
  if (e.target === successModal) closeSuccess();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && successModal.getAttribute("aria-hidden") === "false") closeSuccess();
});

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}
