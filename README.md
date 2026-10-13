# LibSeat: Library Seat Booking System (HCI PBL)

Web app where students sign up, log in and reserve library seats by floor, day and time slot.

## Features
- Sign up / log in (passwords hashed with scrypt, 7-day session tokens)
- Dashboard: booking stats, study hours, next booking, live free-seat bars per floor, recent activity
- Nav bar (responsive, current page highlighted) and footer
- Live seat map with power-outlet and quiet-zone info; taken seats disabled and struck through
- Server-side conflict checks: no double booking, one seat per student per slot
- Check-in opens 15 min before the slot; unclaimed seats auto-release after 15 min; cancel any time
- HCI: plain-language errors, 44px touch targets, labelled forms, keyboard focus, dark mode

## Run (Node.js 18+, no installs)
```
node server.js
```
Open http://localhost:3000 (data is saved in `data.json`)

## API (all except seats/signup/login need `Authorization: Bearer <token>`)
POST /api/signup · POST /api/login · POST /api/logout · GET /api/me · GET /api/seats · GET /api/dashboard · GET/POST /api/bookings · POST /api/bookings/:id/checkin|cancel

## Deploy (Render free tier)
New → Web Service → connect repo → Start command: `node server.js`. Free tier resets `data.json` on redeploy.

## Added features
- Accessibility panel (text size, high contrast, reduce motion), saved per user
- In-app System Usability Scale (SUS) survey with score calculation
- Admin dashboard (only for the fixed admin account, see below): bookings per day, busiest slots, occupancy, average SUS, close/reopen seats
- Undo cancel (15 s) and extend booking into the next slot
- Profile page: change name and password

## Admin login
Students can never become admins. The admin account is created automatically on first start:
- Login: `ADMIN` (or `admin@libseat.com`), password `Admin@12345`
- Change it with the ADMIN_EMAIL and ADMIN_PASSWORD environment variables before the first start, or use Profile > Change password after logging in.
- Students do not see the Admin link, are redirected away from #/admin, and the admin API returns 403 for them.
