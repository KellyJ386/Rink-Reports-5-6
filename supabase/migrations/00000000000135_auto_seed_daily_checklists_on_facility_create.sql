-- =============================================================================
-- 00000000000135_auto_seed_daily_checklists_on_facility_create.sql
--
-- D4 (360 review): the Operations Checklists catalog (migration 106) was
-- seeded only for the original production facility's hardcoded UUID, so every
-- NEW facility started with zero daily-report areas/templates/items.
--
-- 1. seed_default_daily_report_checklists(p_facility_id): the same catalog
--    (17 areas x Opening/Operational/Closing + 506 items), parameterized.
--    Idempotent — areas upsert ON CONFLICT DO NOTHING, templates/items insert
--    WHERE NOT EXISTS — so re-running never duplicates or clobbers admin
--    renames/reorders/deactivations.
-- 2. create_facility_with_roles() now seeds it on facility creation
--    (alongside the migration-120 scheduling seed).
-- 3. Backfill: facilities that currently have NO daily_report_areas at all
--    get the catalog now. Facilities with any existing areas are left
--    untouched (they configured their own).
--
-- Execute is internal-only (migration 122 pattern): revoked from
-- anon/authenticated, granted to service_role; the facility-create RPC calls
-- it as definer. rls_isolation.sql section 2m asserts the gate + the seed
-- counts.
-- =============================================================================

create or replace function public.seed_default_daily_report_checklists(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
-- -----------------------------------------------------------------------------
-- 1. Areas (categories). One row per category; admins may rename/reorder/disable.
-- -----------------------------------------------------------------------------
with cat(slug, name, sort_order, color) as (
  values
    ('front-desk', 'Front Desk', 0, '#6366f1'),
    ('operations', 'Operations', 1, '#0ea5e9'),
    ('custodial-services', 'Custodial Services', 2, '#14b8a6'),
    ('pro-shop', 'Pro Shop', 3, '#8b5cf6'),
    ('concessions', 'Concessions', 4, '#f59e0b'),
    ('learn-to-skate', 'Learn to Skate', 5, '#ec4899'),
    ('public-sessions', 'Public Sessions', 6, '#22c55e'),
    ('safety-emergency', 'Safety & Emergency', 7, '#ef4444'),
    ('general-facility', 'General Facility', 8, '#64748b'),
    ('locker-rooms', 'Locker Rooms', 9, '#06b6d4'),
    ('parking-exterior', 'Parking / Exterior', 10, '#84cc16'),
    ('hvac-building-systems', 'HVAC / Building Systems', 11, '#3b82f6'),
    ('event-setup', 'Event Setup', 12, '#a855f7'),
    ('rental-equipment', 'Rental Equipment', 13, '#f97316'),
    ('skating-aids', 'Skating Aids', 14, '#10b981'),
    ('custom-reserved', 'Custom / Reserved', 15, '#94a3b8'),
    ('financials', 'Financials', 16, '#eab308')
)
insert into public.daily_report_areas (facility_id, name, slug, sort_order, color, is_active)
select f.id, c.name, c.slug, c.sort_order, c.color, true
from public.facilities f
cross join cat c
where f.id = p_facility_id
on conflict (facility_id, slug) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Templates: the Opening / Operational / Closing phase for each area.
-- -----------------------------------------------------------------------------
with tmpl(area_slug, name, sort_order) as (
  values
    ('front-desk', 'Opening', 0),
    ('front-desk', 'Operational', 1),
    ('front-desk', 'Closing', 2),
    ('operations', 'Opening', 0),
    ('operations', 'Operational', 1),
    ('operations', 'Closing', 2),
    ('custodial-services', 'Opening', 0),
    ('custodial-services', 'Operational', 1),
    ('custodial-services', 'Closing', 2),
    ('pro-shop', 'Opening', 0),
    ('pro-shop', 'Operational', 1),
    ('pro-shop', 'Closing', 2),
    ('concessions', 'Opening', 0),
    ('concessions', 'Operational', 1),
    ('concessions', 'Closing', 2),
    ('learn-to-skate', 'Opening', 0),
    ('learn-to-skate', 'Operational', 1),
    ('learn-to-skate', 'Closing', 2),
    ('public-sessions', 'Opening', 0),
    ('public-sessions', 'Operational', 1),
    ('public-sessions', 'Closing', 2),
    ('safety-emergency', 'Opening', 0),
    ('safety-emergency', 'Operational', 1),
    ('safety-emergency', 'Closing', 2),
    ('general-facility', 'Opening', 0),
    ('general-facility', 'Operational', 1),
    ('general-facility', 'Closing', 2),
    ('locker-rooms', 'Opening', 0),
    ('locker-rooms', 'Operational', 1),
    ('locker-rooms', 'Closing', 2),
    ('parking-exterior', 'Opening', 0),
    ('parking-exterior', 'Operational', 1),
    ('parking-exterior', 'Closing', 2),
    ('hvac-building-systems', 'Opening', 0),
    ('hvac-building-systems', 'Operational', 1),
    ('hvac-building-systems', 'Closing', 2),
    ('event-setup', 'Opening', 0),
    ('event-setup', 'Operational', 1),
    ('event-setup', 'Closing', 2),
    ('rental-equipment', 'Opening', 0),
    ('rental-equipment', 'Operational', 1),
    ('rental-equipment', 'Closing', 2),
    ('skating-aids', 'Opening', 0),
    ('skating-aids', 'Operational', 1),
    ('skating-aids', 'Closing', 2),
    ('custom-reserved', 'Opening', 0),
    ('custom-reserved', 'Operational', 1),
    ('custom-reserved', 'Closing', 2),
    ('financials', 'Opening', 0),
    ('financials', 'Operational', 1),
    ('financials', 'Closing', 2)
)
insert into public.daily_report_templates (facility_id, area_id, name, sort_order, is_active)
select a.facility_id, a.id, t.name, t.sort_order, true
from tmpl t
join public.daily_report_areas a
  on a.facility_id = p_facility_id and a.slug = t.area_slug
where not exists (
  select 1 from public.daily_report_templates dt
  where dt.area_id = a.id and dt.name = t.name
);

-- -----------------------------------------------------------------------------
-- 3. Checklist items: the individual checkbox rows for each phase template.
-- -----------------------------------------------------------------------------
with item(area_slug, template_name, sort_order, label) as (
  values
    ('front-desk', 'Opening', 0, 'Unlock front entrance and disarm the security/alarm system.'),
    ('front-desk', 'Opening', 1, 'Power on POS terminal, computer, and card reader; confirm connectivity.'),
    ('front-desk', 'Opening', 2, 'Count and verify the cash drawer float against the logged starting balance; sign the count sheet.'),
    ('front-desk', 'Opening', 3, 'Log in to the booking/scheduling system and review the day''s reservations, lessons, and rentals.'),
    ('front-desk', 'Opening', 4, 'Turn on lobby lighting, music, and schedule/TV monitors.'),
    ('front-desk', 'Opening', 5, 'Check voicemail and email; flag same-day cancellations or messages.'),
    ('front-desk', 'Opening', 6, 'Confirm shift staffing and review the daily schedule board.'),
    ('front-desk', 'Opening', 7, 'Stock waiver forms, day passes, punch cards, and brochures.'),
    ('front-desk', 'Opening', 8, 'Review handoff notes from the previous closing shift.'),
    ('front-desk', 'Operational', 0, 'Greet and check in arriving guests, skaters, and program participants.'),
    ('front-desk', 'Operational', 1, 'Process admissions, rentals, and retail transactions accurately.'),
    ('front-desk', 'Operational', 2, 'Collect and file signed liability waivers before granting ice access.'),
    ('front-desk', 'Operational', 3, 'Answer phones and respond to booking inquiries within service standards.'),
    ('front-desk', 'Operational', 4, 'Monitor session capacity and enforce headcount limits.'),
    ('front-desk', 'Operational', 5, 'Issue and track rental claim tickets or wristbands.'),
    ('front-desk', 'Operational', 6, 'Communicate session changes (resurfacing delays, closures) to guests.'),
    ('front-desk', 'Operational', 7, 'Log incidents, complaints, and refunds per policy.'),
    ('front-desk', 'Operational', 8, 'Coordinate with operations staff on ice schedule transitions.'),
    ('front-desk', 'Operational', 9, 'Keep the desk and lobby tidy; restock forms and supplies as needed.'),
    ('front-desk', 'Closing', 0, 'Reconcile the cash drawer; record the ending balance against the sales report.'),
    ('front-desk', 'Closing', 1, 'Run the end-of-day POS report (Z-report) and record totals.'),
    ('front-desk', 'Closing', 2, 'Prepare the bank deposit and secure cash per cash-handling policy.'),
    ('front-desk', 'Closing', 3, 'Log out of booking/POS systems and power down terminals.'),
    ('front-desk', 'Closing', 4, 'File the day''s signed waivers and completed paperwork.'),
    ('front-desk', 'Closing', 5, 'Clear voicemail and respond to outstanding messages.'),
    ('front-desk', 'Closing', 6, 'Tidy and restock the desk; turn off lobby monitors and music.'),
    ('front-desk', 'Closing', 7, 'Confirm all guests have exited the building.'),
    ('front-desk', 'Closing', 8, 'Turn off lobby lighting and secure the front desk.'),
    ('front-desk', 'Closing', 9, 'Record handoff notes for the next opening shift.'),
    ('operations', 'Opening', 0, 'Review the ice schedule and resurfacing/maintenance plan for the day.'),
    ('operations', 'Opening', 1, 'Inspect the ice surface for cracks, ruts, debris, or damage.'),
    ('operations', 'Opening', 2, 'Check and record ice surface temperature against the target range.'),
    ('operations', 'Opening', 3, 'Inspect the resurfacer (fuel/charge, water levels, blade condition) and bring it to ready.'),
    ('operations', 'Opening', 4, 'Inspect dasher boards, glass, and gates for damage or loose fasteners.'),
    ('operations', 'Opening', 5, 'Fill the resurfacer water tank with hot water at the correct temperature.'),
    ('operations', 'Opening', 6, 'Verify edger and snow-melt pit operation.'),
    ('operations', 'Opening', 7, 'Confirm rink lighting is fully operational.'),
    ('operations', 'Opening', 8, 'Review open work orders and pending maintenance items.'),
    ('operations', 'Operational', 0, 'Perform scheduled ice resurfacing between sessions on time.'),
    ('operations', 'Operational', 1, 'Conduct circle checks and edge work as scheduled.'),
    ('operations', 'Operational', 2, 'Patch low spots, ruts, and goal creases as needed.'),
    ('operations', 'Operational', 3, 'Monitor and adjust ice surface temperature throughout the day.'),
    ('operations', 'Operational', 4, 'Empty and rinse the snow-melt pit after each resurfacing.'),
    ('operations', 'Operational', 5, 'Refill the resurfacer water tank with hot water after each flood.'),
    ('operations', 'Operational', 6, 'Inspect and clear gate tracks and board areas.'),
    ('operations', 'Operational', 7, 'Log each resurfacing with operator, time, and notes.'),
    ('operations', 'Operational', 8, 'Coordinate ice transitions with front desk and program staff.'),
    ('operations', 'Operational', 9, 'Report equipment faults or ice-quality issues immediately.'),
    ('operations', 'Closing', 0, 'Perform the final resurfacing/flood per the overnight ice plan.'),
    ('operations', 'Closing', 1, 'Drain and clean the resurfacer; park it on a dry pad or board.'),
    ('operations', 'Closing', 2, 'Charge the electric resurfacer or top off fuel for the next day.'),
    ('operations', 'Closing', 3, 'Inspect and safely store the blade; note any blade-change needs.'),
    ('operations', 'Closing', 4, 'Empty and rinse the snow-melt pit.'),
    ('operations', 'Closing', 5, 'Record the final ice temperature and surface condition.'),
    ('operations', 'Closing', 6, 'Complete the operations log with all resurfacings and tasks.'),
    ('operations', 'Closing', 7, 'Secure all rink equipment, tools, and the resurfacer room.'),
    ('operations', 'Closing', 8, 'Verify all gates and doors to the ice are closed and secured.'),
    ('operations', 'Closing', 9, 'Record maintenance items and handoff for the next shift.'),
    ('custodial-services', 'Opening', 0, 'Access the custodial supply room and inventory key supplies.'),
    ('custodial-services', 'Opening', 1, 'Inspect restrooms; restock toilet paper, soap, and paper towels.'),
    ('custodial-services', 'Opening', 2, 'Empty and reline trash and recycling receptacles in public areas.'),
    ('custodial-services', 'Opening', 3, 'Spot-clean lobby floors, entry mats, and glass doors.'),
    ('custodial-services', 'Opening', 4, 'Wipe down the front desk, tables, and high-touch surfaces.'),
    ('custodial-services', 'Opening', 5, 'Address any overnight spills, leaks, or messes.'),
    ('custodial-services', 'Opening', 6, 'Confirm cleaning equipment (vacuum, auto-scrubber, mop) is functional.'),
    ('custodial-services', 'Opening', 7, 'Fill hand-sanitizer stations.'),
    ('custodial-services', 'Opening', 8, 'Review custodial notes from the prior shift.'),
    ('custodial-services', 'Operational', 0, 'Clean restrooms on a scheduled rotation and log each check.'),
    ('custodial-services', 'Operational', 1, 'Empty trash and recycling as bins reach capacity.'),
    ('custodial-services', 'Operational', 2, 'Spot-mop spills and wet areas promptly to remove slip hazards.'),
    ('custodial-services', 'Operational', 3, 'Wipe down high-touch surfaces (door handles, railings, benches).'),
    ('custodial-services', 'Operational', 4, 'Maintain lobby, bleacher, and spectator area cleanliness.'),
    ('custodial-services', 'Operational', 5, 'Restock restroom and sanitizer supplies as needed.'),
    ('custodial-services', 'Operational', 6, 'Respond to cleanup calls from staff promptly.'),
    ('custodial-services', 'Operational', 7, 'Keep entryways and walkways clear and dry.'),
    ('custodial-services', 'Operational', 8, 'Remove waste and recycling to the dumpster/compactor.'),
    ('custodial-services', 'Operational', 9, 'Log completed cleaning rounds.'),
    ('custodial-services', 'Closing', 0, 'Deep-clean and sanitize all restrooms; restock fully for the next day.'),
    ('custodial-services', 'Closing', 1, 'Empty all trash and recycling and replace liners.'),
    ('custodial-services', 'Closing', 2, 'Vacuum or auto-scrub lobby and high-traffic floors.'),
    ('custodial-services', 'Closing', 3, 'Clean and sanitize benches, tables, and locker room areas.'),
    ('custodial-services', 'Closing', 4, 'Clean glass doors, windows, and mirrors.'),
    ('custodial-services', 'Closing', 5, 'Clean and store all custodial equipment properly.'),
    ('custodial-services', 'Closing', 6, 'Refill all soap, towel, and sanitizer dispensers.'),
    ('custodial-services', 'Closing', 7, 'Remove all waste to the dumpster/compactor.'),
    ('custodial-services', 'Closing', 8, 'Inspect the facility for cleanliness before lockup.'),
    ('custodial-services', 'Closing', 9, 'Log completed closing tasks and note supply needs.'),
    ('pro-shop', 'Opening', 0, 'Unlock the pro shop and disarm any separate gate or alarm.'),
    ('pro-shop', 'Opening', 1, 'Power on POS, lighting, and display monitors.'),
    ('pro-shop', 'Opening', 2, 'Verify the cash drawer float and reconcile the starting balance.'),
    ('pro-shop', 'Opening', 3, 'Review the day''s skate-sharpening drop-offs and pickups.'),
    ('pro-shop', 'Opening', 4, 'Power on and inspect the sharpening machine; check wheel/stone condition.'),
    ('pro-shop', 'Opening', 5, 'Confirm special orders awaiting pickup and notify customers if needed.'),
    ('pro-shop', 'Opening', 6, 'Straighten displays and restock front-facing inventory.'),
    ('pro-shop', 'Opening', 7, 'Review low-stock alerts and flag reorders.'),
    ('pro-shop', 'Opening', 8, 'Check messages for sharpening or order inquiries.'),
    ('pro-shop', 'Operational', 0, 'Assist customers with retail purchases, fittings, and product questions.'),
    ('pro-shop', 'Operational', 1, 'Log sharpening orders with blade type, hollow/radius, and customer.'),
    ('pro-shop', 'Operational', 2, 'Sharpen to spec and inspect edges before returning skates.'),
    ('pro-shop', 'Operational', 3, 'Conduct skate and equipment fittings (skates, guards, protective gear).'),
    ('pro-shop', 'Operational', 4, 'Process transactions accurately at POS.'),
    ('pro-shop', 'Operational', 5, 'Maintain the sharpening machine: dress the wheel, clear shavings, check coolant.'),
    ('pro-shop', 'Operational', 6, 'Restock and face merchandise throughout the day.'),
    ('pro-shop', 'Operational', 7, 'Track inventory and flag items for reorder.'),
    ('pro-shop', 'Operational', 8, 'Handle special orders and customer follow-ups.'),
    ('pro-shop', 'Operational', 9, 'Keep the sharpening and retail areas clean and safe.'),
    ('pro-shop', 'Closing', 0, 'Complete all pending sharpening jobs or tag them for the next day.'),
    ('pro-shop', 'Closing', 1, 'Power down and clean the sharpening machine; clear metal shavings.'),
    ('pro-shop', 'Closing', 2, 'Reconcile the cash drawer and run the end-of-day sales report.'),
    ('pro-shop', 'Closing', 3, 'Secure cash/deposit per cash-handling policy.'),
    ('pro-shop', 'Closing', 4, 'Tidy and re-face merchandise displays.'),
    ('pro-shop', 'Closing', 5, 'Record inventory sold and update stock counts.'),
    ('pro-shop', 'Closing', 6, 'Log special orders and pickup status.'),
    ('pro-shop', 'Closing', 7, 'Power down POS, monitors, and equipment.'),
    ('pro-shop', 'Closing', 8, 'Turn off lighting and secure the pro shop.'),
    ('pro-shop', 'Closing', 9, 'Note handoff items and reorder needs.'),
    ('concessions', 'Opening', 0, 'Unlock the concession stand and disarm any separate alarm.'),
    ('concessions', 'Opening', 1, 'Wash hands and put on gloves/apron; review food-safety reminders.'),
    ('concessions', 'Opening', 2, 'Power on refrigeration, freezers, and hot-holding units; confirm operation.'),
    ('concessions', 'Opening', 3, 'Record refrigerator and freezer temperatures on the food-safety log.'),
    ('concessions', 'Opening', 4, 'Turn on and preheat cooking equipment (grill, fryer, warmers, popcorn machine).'),
    ('concessions', 'Opening', 5, 'Verify the cash drawer float and reconcile the starting balance.'),
    ('concessions', 'Opening', 6, 'Stock food, beverages, condiments, cups, and napkins.'),
    ('concessions', 'Opening', 7, 'Check expiration dates and rotate stock (FIFO).'),
    ('concessions', 'Opening', 8, 'Sanitize prep and service surfaces; set up sanitizer buckets.'),
    ('concessions', 'Opening', 9, 'Confirm the handwashing sink is stocked with soap, towels, and hot water.'),
    ('concessions', 'Operational', 0, 'Prepare and serve food and beverages following food-safety standards.'),
    ('concessions', 'Operational', 1, 'Record hot-holding and cold-holding temperatures on schedule.'),
    ('concessions', 'Operational', 2, 'Process transactions accurately at POS.'),
    ('concessions', 'Operational', 3, 'Maintain clean prep and service surfaces; refresh sanitizer buckets.'),
    ('concessions', 'Operational', 4, 'Restock items as they run low.'),
    ('concessions', 'Operational', 5, 'Monitor cooking equipment and discard food past hold times.'),
    ('concessions', 'Operational', 6, 'Practice proper handwashing and glove changes.'),
    ('concessions', 'Operational', 7, 'Keep floors dry and free of spills.'),
    ('concessions', 'Operational', 8, 'Manage waste and recycling.'),
    ('concessions', 'Operational', 9, 'Log temperature checks and any food-safety issues.'),
    ('concessions', 'Closing', 0, 'Discard perishables past hold time; date and store remaining stock (FIFO).'),
    ('concessions', 'Closing', 1, 'Record final equipment temperatures on the food-safety log.'),
    ('concessions', 'Closing', 2, 'Power down and clean cooking equipment (grill, fryer, warmers, popcorn machine).'),
    ('concessions', 'Closing', 3, 'Clean and filter fryer grease as scheduled.'),
    ('concessions', 'Closing', 4, 'Reconcile the cash drawer and run the end-of-day sales report.'),
    ('concessions', 'Closing', 5, 'Secure cash/deposit per cash-handling policy.'),
    ('concessions', 'Closing', 6, 'Clean and sanitize all prep, service, and storage surfaces.'),
    ('concessions', 'Closing', 7, 'Sweep and mop floors; empty trash and recycling.'),
    ('concessions', 'Closing', 8, 'Restock for the next day where possible.'),
    ('concessions', 'Closing', 9, 'Secure refrigeration, lock the stand, and log closing tasks.'),
    ('learn-to-skate', 'Opening', 0, 'Review the day''s class roster, levels, and instructor assignments.'),
    ('learn-to-skate', 'Opening', 1, 'Confirm instructor and coach staffing and check-in.'),
    ('learn-to-skate', 'Opening', 2, 'Set out skating aids, cones, markers, and teaching props.'),
    ('learn-to-skate', 'Opening', 3, 'Verify rental skates are available and sized for registered classes.'),
    ('learn-to-skate', 'Opening', 4, 'Confirm Learn to Skate ice times on the schedule.'),
    ('learn-to-skate', 'Opening', 5, 'Prepare attendance sheets and progress/badge tracking.'),
    ('learn-to-skate', 'Opening', 6, 'Review student medical notes or accommodations.'),
    ('learn-to-skate', 'Opening', 7, 'Confirm the class music/sound system is working.'),
    ('learn-to-skate', 'Opening', 8, 'Set up barriers or designated class zones on the ice.'),
    ('learn-to-skate', 'Opening', 9, 'Check messages for student absences or new registrations.'),
    ('learn-to-skate', 'Operational', 0, 'Check in students and take attendance per class.'),
    ('learn-to-skate', 'Operational', 1, 'Distribute and fit rental skates and helmets as needed.'),
    ('learn-to-skate', 'Operational', 2, 'Conduct classes per curriculum and skill level.'),
    ('learn-to-skate', 'Operational', 3, 'Track student progress and update badge/level records.'),
    ('learn-to-skate', 'Operational', 4, 'Manage class zones and safe spacing on shared ice.'),
    ('learn-to-skate', 'Operational', 5, 'Supervise students on and off the ice.'),
    ('learn-to-skate', 'Operational', 6, 'Communicate with parents/guardians at the boards.'),
    ('learn-to-skate', 'Operational', 7, 'Coordinate ice transitions with operations staff.'),
    ('learn-to-skate', 'Operational', 8, 'Address minor injuries per protocol and notify the front desk.'),
    ('learn-to-skate', 'Operational', 9, 'Collect and return skating aids and props between classes.'),
    ('learn-to-skate', 'Closing', 0, 'Collect attendance and finalize progress/badge records for the day.'),
    ('learn-to-skate', 'Closing', 1, 'Gather and store all skating aids, cones, and teaching props.'),
    ('learn-to-skate', 'Closing', 2, 'Collect rental skates and helmets; return to pro shop/rental.'),
    ('learn-to-skate', 'Closing', 3, 'Remove class barriers and zone markers from the ice.'),
    ('learn-to-skate', 'Closing', 4, 'Note make-up classes, absences, and follow-ups.'),
    ('learn-to-skate', 'Closing', 5, 'Communicate completed evaluations to the program coordinator.'),
    ('learn-to-skate', 'Closing', 6, 'Confirm all students have been picked up and exited.'),
    ('learn-to-skate', 'Closing', 7, 'Power down class music/sound equipment.'),
    ('learn-to-skate', 'Closing', 8, 'Tidy the program storage area.'),
    ('learn-to-skate', 'Closing', 9, 'Log session notes and handoff items.'),
    ('public-sessions', 'Opening', 0, 'Confirm public session times and capacity limits on the schedule.'),
    ('public-sessions', 'Opening', 1, 'Set up the admission/check-in station with wristbands or stamps.'),
    ('public-sessions', 'Opening', 2, 'Verify rental skates are stocked and sized for expected volume.'),
    ('public-sessions', 'Opening', 3, 'Brief skate guards/monitors on session rules and zones.'),
    ('public-sessions', 'Opening', 4, 'Confirm the ice has been resurfaced before the session.'),
    ('public-sessions', 'Opening', 5, 'Set out safety signage (skate at own risk, rules of the ice).'),
    ('public-sessions', 'Opening', 6, 'Confirm the first-aid kit and AED are accessible.'),
    ('public-sessions', 'Opening', 7, 'Set up skating aids if offered for the session.'),
    ('public-sessions', 'Opening', 8, 'Test the music/sound system and announcements.'),
    ('public-sessions', 'Opening', 9, 'Confirm benches and skate-change areas are ready.'),
    ('public-sessions', 'Operational', 0, 'Check in skaters and collect admissions and waivers.'),
    ('public-sessions', 'Operational', 1, 'Issue and track rental skates and skating aids.'),
    ('public-sessions', 'Operational', 2, 'Station skate guards to monitor the ice and enforce rules.'),
    ('public-sessions', 'Operational', 3, 'Enforce session capacity and direction-of-skating rules.'),
    ('public-sessions', 'Operational', 4, 'Conduct scheduled ice breaks/resurfacing per session length.'),
    ('public-sessions', 'Operational', 5, 'Monitor for unsafe behavior and intervene as needed.'),
    ('public-sessions', 'Operational', 6, 'Respond to falls/injuries per first-aid protocol; log incidents.'),
    ('public-sessions', 'Operational', 7, 'Make session announcements (breaks, last skate, closing).'),
    ('public-sessions', 'Operational', 8, 'Keep skate-change and bench areas orderly.'),
    ('public-sessions', 'Operational', 9, 'Coordinate end-of-session ice clearing.'),
    ('public-sessions', 'Closing', 0, 'Announce and clear the final session; ensure all skaters exit the ice.'),
    ('public-sessions', 'Closing', 1, 'Collect all rental skates and skating aids for processing.'),
    ('public-sessions', 'Closing', 2, 'Take down safety signage and the admission station.'),
    ('public-sessions', 'Closing', 3, 'Inspect the ice and surrounding areas for left items or hazards.'),
    ('public-sessions', 'Closing', 4, 'Reconcile the session admissions count with the front desk.'),
    ('public-sessions', 'Closing', 5, 'Log incidents and session notes.'),
    ('public-sessions', 'Closing', 6, 'Tidy benches, skate-change areas, and the lobby.'),
    ('public-sessions', 'Closing', 7, 'Confirm all guests have exited the building.'),
    ('public-sessions', 'Closing', 8, 'Hand off rental returns to pro shop/rental.'),
    ('public-sessions', 'Closing', 9, 'Note follow-ups for the next session.'),
    ('safety-emergency', 'Opening', 0, 'Verify all emergency exits are unlocked, unobstructed, and illuminated.'),
    ('safety-emergency', 'Opening', 1, 'Confirm first-aid kits are stocked and accessible.'),
    ('safety-emergency', 'Opening', 2, 'Check the AED: status indicator, pads in date, and battery.'),
    ('safety-emergency', 'Opening', 3, 'Test emergency communication equipment (radios, phones, PA).'),
    ('safety-emergency', 'Opening', 4, 'Confirm fire extinguishers are charged, tagged, and accessible.'),
    ('safety-emergency', 'Opening', 5, 'Verify emergency lighting and exit signs are functional.'),
    ('safety-emergency', 'Opening', 6, 'Review the day''s events for crowd and capacity considerations.'),
    ('safety-emergency', 'Opening', 7, 'Confirm on-shift staff know their emergency roles and procedures.'),
    ('safety-emergency', 'Opening', 8, 'Stock incident and accident report forms.'),
    ('safety-emergency', 'Opening', 9, 'Inspect public areas for slip and trip hazards.'),
    ('safety-emergency', 'Operational', 0, 'Monitor the facility for hazards (wet floors, blocked exits, ice debris).'),
    ('safety-emergency', 'Operational', 1, 'Keep emergency exits and pathways clear at all times.'),
    ('safety-emergency', 'Operational', 2, 'Respond to incidents and accidents per protocol; provide first aid.'),
    ('safety-emergency', 'Operational', 3, 'Document every incident and accident on the proper form.'),
    ('safety-emergency', 'Operational', 4, 'Enforce capacity limits for sessions and events.'),
    ('safety-emergency', 'Operational', 5, 'Keep first-aid kits and the AED accessible and stocked.'),
    ('safety-emergency', 'Operational', 6, 'Communicate hazards and resolutions to staff.'),
    ('safety-emergency', 'Operational', 7, 'Conduct periodic safety walk-throughs.'),
    ('safety-emergency', 'Operational', 8, 'Coordinate with operations on ice-related safety issues.'),
    ('safety-emergency', 'Operational', 9, 'Escalate emergencies per the emergency action plan.'),
    ('safety-emergency', 'Closing', 0, 'Confirm all incidents and accidents from the day are documented and filed.'),
    ('safety-emergency', 'Closing', 1, 'Restock first-aid supplies used during the day.'),
    ('safety-emergency', 'Closing', 2, 'Verify the AED and fire extinguishers remain accessible and intact.'),
    ('safety-emergency', 'Closing', 3, 'Confirm emergency exits are secure but functional for the next day.'),
    ('safety-emergency', 'Closing', 4, 'Confirm emergency lighting and exit signs remain operational.'),
    ('safety-emergency', 'Closing', 5, 'Review and file the day''s safety logs and reports.'),
    ('safety-emergency', 'Closing', 6, 'Note hazards requiring maintenance work orders.'),
    ('safety-emergency', 'Closing', 7, 'Confirm the building is clear of all occupants.'),
    ('safety-emergency', 'Closing', 8, 'Reset and charge emergency communication equipment.'),
    ('safety-emergency', 'Closing', 9, 'Hand off any open safety items to the next shift.'),
    ('general-facility', 'Opening', 0, 'Unlock the building and disarm the main security system.'),
    ('general-facility', 'Opening', 1, 'Turn on facility lighting (lobby, rink, corridors, restrooms).'),
    ('general-facility', 'Opening', 2, 'Walk the building interior and perimeter for overnight issues.'),
    ('general-facility', 'Opening', 3, 'Confirm heating/ventilation is at the occupied-operation target.'),
    ('general-facility', 'Opening', 4, 'Confirm all public areas are clean and presentable.'),
    ('general-facility', 'Opening', 5, 'Verify signage, schedules, and wayfinding are posted and current.'),
    ('general-facility', 'Opening', 6, 'Confirm all required staff have arrived and are stationed.'),
    ('general-facility', 'Opening', 7, 'Check for overnight alarms, leaks, or maintenance issues.'),
    ('general-facility', 'Opening', 8, 'Confirm network/Wi-Fi and phone systems are operational.'),
    ('general-facility', 'Opening', 9, 'Review the day''s master schedule across all areas.'),
    ('general-facility', 'Operational', 0, 'Monitor overall building condition and comfort throughout the day.'),
    ('general-facility', 'Operational', 1, 'Coordinate between departments (front desk, operations, programs).'),
    ('general-facility', 'Operational', 2, 'Address facility issues and generate work orders as needed.'),
    ('general-facility', 'Operational', 3, 'Maintain presentable public and spectator areas.'),
    ('general-facility', 'Operational', 4, 'Adjust lighting and HVAC for occupancy and energy use.'),
    ('general-facility', 'Operational', 5, 'Ensure compliance with capacity and safety standards.'),
    ('general-facility', 'Operational', 6, 'Respond to guest concerns escalated by staff.'),
    ('general-facility', 'Operational', 7, 'Track and follow up on open maintenance items.'),
    ('general-facility', 'Operational', 8, 'Confirm scheduled events and programs transition smoothly.'),
    ('general-facility', 'Operational', 9, 'Keep communication flowing between shifts and departments.'),
    ('general-facility', 'Closing', 0, 'Confirm all programs, sessions, and events have ended.'),
    ('general-facility', 'Closing', 1, 'Walk the building to verify all occupants have exited.'),
    ('general-facility', 'Closing', 2, 'Turn off non-essential lighting and equipment.'),
    ('general-facility', 'Closing', 3, 'Set HVAC to unoccupied/overnight settings.'),
    ('general-facility', 'Closing', 4, 'Confirm all interior doors and areas are secured.'),
    ('general-facility', 'Closing', 5, 'Verify all departments have completed their closing checklists.'),
    ('general-facility', 'Closing', 6, 'Address any end-of-day hazards or issues.'),
    ('general-facility', 'Closing', 7, 'Arm the security system and lock all exterior doors.'),
    ('general-facility', 'Closing', 8, 'Complete the master closing log.'),
    ('general-facility', 'Closing', 9, 'Note open items and handoff for the next opening shift.'),
    ('locker-rooms', 'Opening', 0, 'Unlock assigned locker rooms per the day''s schedule.'),
    ('locker-rooms', 'Opening', 1, 'Inspect for cleanliness; spot-clean floors, benches, and surfaces.'),
    ('locker-rooms', 'Opening', 2, 'Confirm locker-room restrooms/showers are stocked and clean.'),
    ('locker-rooms', 'Opening', 3, 'Check for left-behind items and route to lost-and-found.'),
    ('locker-rooms', 'Opening', 4, 'Verify lighting and ventilation are working.'),
    ('locker-rooms', 'Opening', 5, 'Confirm locker assignments for teams and programs are posted.'),
    ('locker-rooms', 'Opening', 6, 'Check for damage, vandalism, or maintenance needs.'),
    ('locker-rooms', 'Opening', 7, 'Empty and reline trash receptacles.'),
    ('locker-rooms', 'Opening', 8, 'Confirm rented/team lockers are ready.'),
    ('locker-rooms', 'Opening', 9, 'Note locker-room schedule conflicts for the day.'),
    ('locker-rooms', 'Operational', 0, 'Assign and unlock locker rooms for teams, programs, and rentals per schedule.'),
    ('locker-rooms', 'Operational', 1, 'Tidy locker rooms between groups.'),
    ('locker-rooms', 'Operational', 2, 'Restock supplies and empty trash as needed.'),
    ('locker-rooms', 'Operational', 3, 'Address spills, wet floors, and hazards promptly.'),
    ('locker-rooms', 'Operational', 4, 'Enforce locker-room rules and access policies.'),
    ('locker-rooms', 'Operational', 5, 'Respond to lost-and-found inquiries.'),
    ('locker-rooms', 'Operational', 6, 'Coordinate locker-room turnover between bookings.'),
    ('locker-rooms', 'Operational', 7, 'Report damage or maintenance issues.'),
    ('locker-rooms', 'Operational', 8, 'Ensure privacy and supervision policies are followed.'),
    ('locker-rooms', 'Operational', 9, 'Secure rooms between scheduled uses.'),
    ('locker-rooms', 'Closing', 0, 'Clear all locker rooms and confirm no occupants remain.'),
    ('locker-rooms', 'Closing', 1, 'Collect lost-and-found items; log and store them.'),
    ('locker-rooms', 'Closing', 2, 'Clean and sanitize floors, benches, showers, and restrooms.'),
    ('locker-rooms', 'Closing', 3, 'Empty all trash and replace liners.'),
    ('locker-rooms', 'Closing', 4, 'Restock supplies for the next day.'),
    ('locker-rooms', 'Closing', 5, 'Inspect for damage and note maintenance needs.'),
    ('locker-rooms', 'Closing', 6, 'Confirm all personal items are removed from day-use lockers.'),
    ('locker-rooms', 'Closing', 7, 'Turn off lighting and adjust ventilation as appropriate.'),
    ('locker-rooms', 'Closing', 8, 'Lock all locker rooms.'),
    ('locker-rooms', 'Closing', 9, 'Log closing tasks and any issues.'),
    ('parking-exterior', 'Opening', 0, 'Inspect the parking lot and walkways for hazards (ice, snow, debris, potholes).'),
    ('parking-exterior', 'Opening', 1, 'Confirm snow/ice removal and salting is complete (seasonal).'),
    ('parking-exterior', 'Opening', 2, 'Verify exterior lighting status (off for daytime, functional for evening).'),
    ('parking-exterior', 'Opening', 3, 'Confirm entrance signage and wayfinding are visible and intact.'),
    ('parking-exterior', 'Opening', 4, 'Clear and inspect building entrances and exits.'),
    ('parking-exterior', 'Opening', 5, 'Confirm accessible parking and ramps are clear and marked.'),
    ('parking-exterior', 'Opening', 6, 'Empty exterior trash receptacles as needed.'),
    ('parking-exterior', 'Opening', 7, 'Inspect for overnight vandalism, damage, or dumping.'),
    ('parking-exterior', 'Opening', 8, 'Confirm bike racks and exterior fixtures are secure.'),
    ('parking-exterior', 'Opening', 9, 'Note any exterior maintenance items.'),
    ('parking-exterior', 'Operational', 0, 'Monitor the lot for capacity and safe traffic flow during events.'),
    ('parking-exterior', 'Operational', 1, 'Maintain clear, safe walkways and entrances (de-ice/salt as needed).'),
    ('parking-exterior', 'Operational', 2, 'Respond to weather conditions (snow, ice, rain) promptly.'),
    ('parking-exterior', 'Operational', 3, 'Keep accessible parking and routes clear.'),
    ('parking-exterior', 'Operational', 4, 'Empty exterior trash receptacles as needed.'),
    ('parking-exterior', 'Operational', 5, 'Address spills, leaks, or hazards in exterior areas.'),
    ('parking-exterior', 'Operational', 6, 'Direct traffic and parking during peak events if needed.'),
    ('parking-exterior', 'Operational', 7, 'Monitor exterior lighting at dusk.'),
    ('parking-exterior', 'Operational', 8, 'Report exterior damage or safety issues.'),
    ('parking-exterior', 'Operational', 9, 'Coordinate with custodial on entrance cleanliness.'),
    ('parking-exterior', 'Closing', 0, 'Inspect the lot and walkways for end-of-day hazards.'),
    ('parking-exterior', 'Closing', 1, 'Confirm exterior lighting is on for evening/overnight safety.'),
    ('parking-exterior', 'Closing', 2, 'Clear and salt walkways and entrances (seasonal).'),
    ('parking-exterior', 'Closing', 3, 'Empty exterior trash receptacles.'),
    ('parking-exterior', 'Closing', 4, 'Confirm gates, exterior storage, and fixtures are secured.'),
    ('parking-exterior', 'Closing', 5, 'Check for left vehicles and note if applicable.'),
    ('parking-exterior', 'Closing', 6, 'Confirm entrances and exits are locked and secure.'),
    ('parking-exterior', 'Closing', 7, 'Note overnight weather-prep needs (plowing, salting).'),
    ('parking-exterior', 'Closing', 8, 'Log exterior conditions and maintenance items.'),
    ('parking-exterior', 'Closing', 9, 'Hand off weather/exterior items to the next shift.'),
    ('hvac-building-systems', 'Opening', 0, 'Review the building automation system (BAS) for overnight alarms or faults.'),
    ('hvac-building-systems', 'Opening', 1, 'Confirm heating/ventilation is set to occupied mode at target setpoints.'),
    ('hvac-building-systems', 'Opening', 2, 'Check dehumidification operation (critical for fog and condensation control).'),
    ('hvac-building-systems', 'Opening', 3, 'Verify air-handling units are running and no filter alarms are active.'),
    ('hvac-building-systems', 'Opening', 4, 'Record rink-side and lobby temperature and humidity readings.'),
    ('hvac-building-systems', 'Opening', 5, 'Inspect for condensation, fog, or ceiling drip over the ice.'),
    ('hvac-building-systems', 'Opening', 6, 'Confirm exhaust and fresh-air ventilation rates for occupancy.'),
    ('hvac-building-systems', 'Opening', 7, 'Check boiler/water-heater status and pressures.'),
    ('hvac-building-systems', 'Opening', 8, 'Verify CO/NO2 air-quality sensors are functioning.'),
    ('hvac-building-systems', 'Opening', 9, 'Log opening readings and any anomalies.'),
    ('hvac-building-systems', 'Operational', 0, 'Monitor temperature, humidity, and air quality throughout the day.'),
    ('hvac-building-systems', 'Operational', 1, 'Adjust ventilation and dehumidification for occupancy and conditions.'),
    ('hvac-building-systems', 'Operational', 2, 'Watch for fog/condensation over the ice and respond promptly.'),
    ('hvac-building-systems', 'Operational', 3, 'Record scheduled BAS/system readings each shift.'),
    ('hvac-building-systems', 'Operational', 4, 'Respond to comfort complaints (too warm, cold, or stuffy).'),
    ('hvac-building-systems', 'Operational', 5, 'Monitor air-quality readings and escalate per thresholds.'),
    ('hvac-building-systems', 'Operational', 6, 'Inspect and change/clean filters per schedule.'),
    ('hvac-building-systems', 'Operational', 7, 'Coordinate with refrigeration on heat load and ice conditions.'),
    ('hvac-building-systems', 'Operational', 8, 'Log system readings and any faults.'),
    ('hvac-building-systems', 'Operational', 9, 'Generate work orders for HVAC issues.'),
    ('hvac-building-systems', 'Closing', 0, 'Set heating/ventilation to unoccupied/overnight setpoints.'),
    ('hvac-building-systems', 'Closing', 1, 'Confirm dehumidification remains active per overnight requirements.'),
    ('hvac-building-systems', 'Closing', 2, 'Record end-of-day temperature, humidity, and air-quality readings.'),
    ('hvac-building-systems', 'Closing', 3, 'Resolve any system alarms before lockup.'),
    ('hvac-building-systems', 'Closing', 4, 'Verify air-handling and exhaust systems are in night mode.'),
    ('hvac-building-systems', 'Closing', 5, 'Confirm boiler/water-heater status for overnight.'),
    ('hvac-building-systems', 'Closing', 6, 'Inspect for overnight condensation or fog risk.'),
    ('hvac-building-systems', 'Closing', 7, 'Log closing readings and any open faults.'),
    ('hvac-building-systems', 'Closing', 8, 'Note any after-hours system monitoring needs.'),
    ('hvac-building-systems', 'Closing', 9, 'Hand off open HVAC items to the next shift.'),
    ('event-setup', 'Opening', 0, 'Review the event schedule and setup requirements for the day.'),
    ('event-setup', 'Opening', 1, 'Confirm event details against the booking/event sheet (times, layout, needs).'),
    ('event-setup', 'Opening', 2, 'Inspect and stage required equipment (chairs, tables, staging, barriers).'),
    ('event-setup', 'Opening', 3, 'Set up seating, spectator areas, and crowd-control barriers per layout.'),
    ('event-setup', 'Opening', 4, 'Confirm AV/sound, scoreboard, and lighting needs for the event.'),
    ('event-setup', 'Opening', 5, 'Coordinate ice prep and timing with operations.'),
    ('event-setup', 'Opening', 6, 'Set up registration/check-in or ticketing tables if needed.'),
    ('event-setup', 'Opening', 7, 'Post event signage and wayfinding.'),
    ('event-setup', 'Opening', 8, 'Verify event staffing and roles.'),
    ('event-setup', 'Opening', 9, 'Confirm vendor and rental deliveries have arrived.'),
    ('event-setup', 'Operational', 0, 'Execute setup per the approved layout and timeline.'),
    ('event-setup', 'Operational', 1, 'Manage AV, scoreboard, music, and lighting during the event.'),
    ('event-setup', 'Operational', 2, 'Maintain crowd-control barriers and spectator areas.'),
    ('event-setup', 'Operational', 3, 'Coordinate ice resurfacing and transitions around the event.'),
    ('event-setup', 'Operational', 4, 'Support event staff and respond to organizer requests.'),
    ('event-setup', 'Operational', 5, 'Monitor capacity and safety during the event.'),
    ('event-setup', 'Operational', 6, 'Manage signage and directional needs.'),
    ('event-setup', 'Operational', 7, 'Coordinate vendor and concession needs for the event.'),
    ('event-setup', 'Operational', 8, 'Log the event timeline and any issues.'),
    ('event-setup', 'Operational', 9, 'Communicate with front desk and operations throughout.'),
    ('event-setup', 'Closing', 0, 'Tear down event setup (seating, staging, barriers, tables).'),
    ('event-setup', 'Closing', 1, 'Power down and store AV, scoreboard, and lighting equipment.'),
    ('event-setup', 'Closing', 2, 'Return rented/borrowed equipment and confirm vendor pickups.'),
    ('event-setup', 'Closing', 3, 'Inspect the event space and ice for damage or left items.'),
    ('event-setup', 'Closing', 4, 'Coordinate post-event ice resurfacing with operations.'),
    ('event-setup', 'Closing', 5, 'Return the space to standard configuration.'),
    ('event-setup', 'Closing', 6, 'Collect and store all event signage.'),
    ('event-setup', 'Closing', 7, 'Reconcile event-related counts/revenue with the front desk.'),
    ('event-setup', 'Closing', 8, 'Log event-completion notes and any damage or issues.'),
    ('event-setup', 'Closing', 9, 'Hand off follow-ups (billing, damage reports) to the coordinator.'),
    ('rental-equipment', 'Opening', 0, 'Access the rental/skate room.'),
    ('rental-equipment', 'Opening', 1, 'Inventory rental skates by size and confirm counts against the log.'),
    ('rental-equipment', 'Opening', 2, 'Inspect skates for dull/damaged blades, broken laces, and loose rivets.'),
    ('rental-equipment', 'Opening', 3, 'Confirm helmets and protective gear are clean and undamaged.'),
    ('rental-equipment', 'Opening', 4, 'Set up the rental station (claim tickets, wristbands, or shoe-hold system).'),
    ('rental-equipment', 'Opening', 5, 'Post the sizing chart and rental pricing.'),
    ('rental-equipment', 'Opening', 6, 'Stock sizing tools and replacement laces.'),
    ('rental-equipment', 'Opening', 7, 'Sanitize high-touch rental gear per policy.'),
    ('rental-equipment', 'Opening', 8, 'Confirm sharpening status of rental skates.'),
    ('rental-equipment', 'Opening', 9, 'Review the day''s expected rental volume.'),
    ('rental-equipment', 'Operational', 0, 'Fit and issue rental skates, helmets, and gear by size.'),
    ('rental-equipment', 'Operational', 1, 'Track each rental with a claim ticket/wristband and the customer''s shoes.'),
    ('rental-equipment', 'Operational', 2, 'Inspect returned skates for damage; pull damaged pairs for repair.'),
    ('rental-equipment', 'Operational', 3, 'Sanitize helmets and shared gear between users.'),
    ('rental-equipment', 'Operational', 4, 'Re-rack returned skates by size.'),
    ('rental-equipment', 'Operational', 5, 'Maintain accurate rental counts throughout the session.'),
    ('rental-equipment', 'Operational', 6, 'Replace broken laces and address minor repairs.'),
    ('rental-equipment', 'Operational', 7, 'Flag skates needing sharpening or blade work.'),
    ('rental-equipment', 'Operational', 8, 'Keep the rental area organized and safe.'),
    ('rental-equipment', 'Operational', 9, 'Log damaged or out-of-service equipment.'),
    ('rental-equipment', 'Closing', 0, 'Collect all outstanding rentals; reconcile against claim tickets.'),
    ('rental-equipment', 'Closing', 1, 'Inspect all returned skates and gear for damage.'),
    ('rental-equipment', 'Closing', 2, 'Pull and tag skates needing sharpening or repair.'),
    ('rental-equipment', 'Closing', 3, 'Sanitize helmets and shared protective gear.'),
    ('rental-equipment', 'Closing', 4, 'Re-rack all skates by size and confirm inventory counts.'),
    ('rental-equipment', 'Closing', 5, 'Restock laces and rental supplies for the next day.'),
    ('rental-equipment', 'Closing', 6, 'Note missing or unreturned equipment.'),
    ('rental-equipment', 'Closing', 7, 'Secure the rental room.'),
    ('rental-equipment', 'Closing', 8, 'Update the rental inventory log.'),
    ('rental-equipment', 'Closing', 9, 'Hand off repair/sharpening needs to the pro shop.'),
    ('skating-aids', 'Opening', 0, 'Inventory skating aids (walkers/supports) and confirm counts.'),
    ('skating-aids', 'Opening', 1, 'Inspect each aid for cracks, sharp edges, loose parts, or damage.'),
    ('skating-aids', 'Opening', 2, 'Clean and sanitize aids per policy.'),
    ('skating-aids', 'Opening', 3, 'Stage aids at the designated distribution point near the ice.'),
    ('skating-aids', 'Opening', 4, 'Post rental pricing or program-inclusion information.'),
    ('skating-aids', 'Opening', 5, 'Ready the aid sign-out/tracking system.'),
    ('skating-aids', 'Opening', 6, 'Pull and tag any damaged aids out of service.'),
    ('skating-aids', 'Opening', 7, 'Confirm the storage area is accessible and organized.'),
    ('skating-aids', 'Opening', 8, 'Coordinate aid availability with Learn to Skate and public sessions.'),
    ('skating-aids', 'Opening', 9, 'Review expected demand for the day.'),
    ('skating-aids', 'Operational', 0, 'Distribute skating aids to skaters and track usage.'),
    ('skating-aids', 'Operational', 1, 'Demonstrate safe use of aids to first-time users.'),
    ('skating-aids', 'Operational', 2, 'Monitor aids on the ice for safe use and spacing.'),
    ('skating-aids', 'Operational', 3, 'Inspect aids on return for damage.'),
    ('skating-aids', 'Operational', 4, 'Sanitize aids between users per policy.'),
    ('skating-aids', 'Operational', 5, 'Re-stage available aids at the distribution point.'),
    ('skating-aids', 'Operational', 6, 'Pull and tag damaged aids during the session.'),
    ('skating-aids', 'Operational', 7, 'Maintain accurate counts of aids in use vs. available.'),
    ('skating-aids', 'Operational', 8, 'Coordinate with skate guards on aid users on the ice.'),
    ('skating-aids', 'Operational', 9, 'Log usage and any issues.'),
    ('skating-aids', 'Closing', 0, 'Collect all skating aids from the ice and distribution point.'),
    ('skating-aids', 'Closing', 1, 'Inspect each aid for damage; tag any needing repair or removal.'),
    ('skating-aids', 'Closing', 2, 'Sanitize all aids per policy.'),
    ('skating-aids', 'Closing', 3, 'Re-rack/store all aids and confirm the full inventory count.'),
    ('skating-aids', 'Closing', 4, 'Note missing or damaged aids.'),
    ('skating-aids', 'Closing', 5, 'Restock the distribution point for the next day.'),
    ('skating-aids', 'Closing', 6, 'Secure the storage area.'),
    ('skating-aids', 'Closing', 7, 'Update the skating-aid inventory log.'),
    ('skating-aids', 'Closing', 8, 'Confirm none are left on the ice or in walkways.'),
    ('skating-aids', 'Closing', 9, 'Hand off repair needs and counts to the next shift.'),
    ('custom-reserved', 'Opening', 0, 'Unlock and access the assigned area or space.'),
    ('custom-reserved', 'Opening', 1, 'Inspect the area for cleanliness, safety, and readiness.'),
    ('custom-reserved', 'Opening', 2, 'Confirm area-specific equipment and supplies are present and functional.'),
    ('custom-reserved', 'Opening', 3, 'Review the day''s bookings or scheduled use for this area.'),
    ('custom-reserved', 'Opening', 4, 'Set up the area per the day''s requirements.'),
    ('custom-reserved', 'Opening', 5, 'Verify lighting, ventilation, and comfort conditions.'),
    ('custom-reserved', 'Opening', 6, 'Check for damage or maintenance needs.'),
    ('custom-reserved', 'Opening', 7, 'Confirm area-specific safety equipment is accessible.'),
    ('custom-reserved', 'Opening', 8, 'Review handoff notes from the prior shift.'),
    ('custom-reserved', 'Opening', 9, '[Admin: add facility-specific opening items here.]'),
    ('custom-reserved', 'Operational', 0, 'Manage scheduled use and turnover for this area.'),
    ('custom-reserved', 'Operational', 1, 'Monitor the area for cleanliness, safety, and capacity.'),
    ('custom-reserved', 'Operational', 2, 'Restock supplies and address issues as they arise.'),
    ('custom-reserved', 'Operational', 3, 'Coordinate this area''s use with related departments.'),
    ('custom-reserved', 'Operational', 4, 'Respond to user and guest needs in this area.'),
    ('custom-reserved', 'Operational', 5, 'Track usage, bookings, or transactions specific to this area.'),
    ('custom-reserved', 'Operational', 6, 'Maintain area-specific equipment.'),
    ('custom-reserved', 'Operational', 7, 'Log any incidents or maintenance items.'),
    ('custom-reserved', 'Operational', 8, 'Enforce area-specific rules and policies.'),
    ('custom-reserved', 'Operational', 9, '[Admin: add facility-specific operational items here.]'),
    ('custom-reserved', 'Closing', 0, 'Clear the area and confirm no occupants remain.'),
    ('custom-reserved', 'Closing', 1, 'Clean and reset the area to standard configuration.'),
    ('custom-reserved', 'Closing', 2, 'Secure and store area-specific equipment and supplies.'),
    ('custom-reserved', 'Closing', 3, 'Inspect for damage and note maintenance needs.'),
    ('custom-reserved', 'Closing', 4, 'Reconcile any usage counts or revenue for this area.'),
    ('custom-reserved', 'Closing', 5, 'Restock for the next day.'),
    ('custom-reserved', 'Closing', 6, 'Turn off lighting and equipment; secure the space.'),
    ('custom-reserved', 'Closing', 7, 'Log closing tasks and open items.'),
    ('custom-reserved', 'Closing', 8, 'Hand off follow-ups to the next shift.'),
    ('custom-reserved', 'Closing', 9, '[Admin: add facility-specific closing items here.]'),
    ('financials', 'Opening', 0, 'Confirm all POS and cash drawers have verified starting floats.'),
    ('financials', 'Opening', 1, 'Reconcile prior-day deposits against the deposit log.'),
    ('financials', 'Opening', 2, 'Confirm prior-day Z-reports/sales summaries are filed.'),
    ('financials', 'Opening', 3, 'Verify the safe balance and petty cash against the log.'),
    ('financials', 'Opening', 4, 'Review outstanding invoices, deposits owed, and pending refunds.'),
    ('financials', 'Opening', 5, 'Confirm payment processing and card systems are online.'),
    ('financials', 'Opening', 6, 'Review the day''s expected revenue events (programs, rentals, events).'),
    ('financials', 'Opening', 7, 'Check for overnight chargebacks or payment discrepancies.'),
    ('financials', 'Opening', 8, 'Confirm change/coin supply is adequate for the day.'),
    ('financials', 'Opening', 9, 'Note financial handoff items from the prior shift.'),
    ('financials', 'Operational', 0, 'Monitor cash handling and POS accuracy across departments.'),
    ('financials', 'Operational', 1, 'Track revenue by category (admissions, rentals, retail, concessions, programs).'),
    ('financials', 'Operational', 2, 'Process refunds, voids, and adjustments per policy with documentation.'),
    ('financials', 'Operational', 3, 'Make mid-day deposits or cash pickups per cash-handling policy.'),
    ('financials', 'Operational', 4, 'Reconcile department drawers at shift changes.'),
    ('financials', 'Operational', 5, 'Document all financial exceptions and discrepancies.'),
    ('financials', 'Operational', 6, 'Manage petty-cash disbursements with receipts.'),
    ('financials', 'Operational', 7, 'Coordinate billing for events, rentals, and program registrations.'),
    ('financials', 'Operational', 8, 'Monitor payment processing for failures or holds.'),
    ('financials', 'Operational', 9, 'Log financial activity throughout the day.'),
    ('financials', 'Closing', 0, 'Collect and reconcile all department cash drawers against sales reports.'),
    ('financials', 'Closing', 1, 'Run consolidated end-of-day sales/Z-reports across all POS stations.'),
    ('financials', 'Closing', 2, 'Reconcile total cash, card, and other tender against system totals.'),
    ('financials', 'Closing', 3, 'Investigate and document any overages or shortages.'),
    ('financials', 'Closing', 4, 'Prepare the bank deposit and complete the deposit log.'),
    ('financials', 'Closing', 5, 'Secure all cash in the safe per cash-handling policy.'),
    ('financials', 'Closing', 6, 'Reset drawer floats for the next day.'),
    ('financials', 'Closing', 7, 'File all sales reports, deposit records, and exception documentation.'),
    ('financials', 'Closing', 8, 'Confirm payment-processing batches have settled.'),
    ('financials', 'Closing', 9, 'Complete the daily financial summary and hand off open items.')
)
insert into public.daily_report_checklist_items (facility_id, template_id, label, sort_order, is_active)
select t.facility_id, t.id, i.label, i.sort_order, true
from item i
join public.daily_report_areas a on a.facility_id = p_facility_id and a.slug = i.area_slug
join public.daily_report_templates t on t.area_id = a.id and t.name = i.template_name
where not exists (
  select 1 from public.daily_report_checklist_items ci
  where ci.template_id = t.id and ci.label = i.label
);

end;
$fn$;

revoke execute on function public.seed_default_daily_report_checklists(uuid) from public;
revoke execute on function public.seed_default_daily_report_checklists(uuid) from anon;
revoke execute on function public.seed_default_daily_report_checklists(uuid) from authenticated;
grant  execute on function public.seed_default_daily_report_checklists(uuid) to service_role;

comment on function public.seed_default_daily_report_checklists(uuid) is
  'Seeds the standard Operations Checklists catalog (17 areas, 51 phase '
  'templates, 506 items) for one facility. Idempotent. Called by '
  'create_facility_with_roles on facility creation; service_role may invoke '
  'it directly to backfill.';

-- -----------------------------------------------------------------------------
-- Facility creation now seeds the checklist catalog too.
-- -----------------------------------------------------------------------------
create or replace function public.create_facility_with_roles(
  p_name      text,
  p_slug      text,
  p_timezone  text,
  p_address   text    default null,
  p_zip_code  text    default null,
  p_phone     text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
begin
  -- Only platform super_admins may create facilities.
  if not public.is_super_admin() then
    raise exception 'create_facility_with_roles: caller is not a super_admin';
  end if;

  if length(trim(p_name)) < 2 then
    raise exception 'create_facility_with_roles: name is too short';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'create_facility_with_roles: invalid slug format';
  end if;

  insert into public.facilities (
    name, slug, timezone, address, zip_code, phone, is_active
  ) values (
    trim(p_name), lower(trim(p_slug)), coalesce(nullif(trim(p_timezone), ''), 'America/New_York'),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_zip_code, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    true
  )
  returning id into v_facility_id;

  insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
  values
    (v_facility_id, 'super_admin', 'Super Admin',    0, true),
    (v_facility_id, 'admin',       'Administrator',  1, true),
    (v_facility_id, 'gm',          'General Manager',2, true),
    (v_facility_id, 'manager',     'Manager',        3, true),
    (v_facility_id, 'supervisor',  'Supervisor',     4, true),
    (v_facility_id, 'staff',       'Staff',          5, true)
  on conflict (facility_id, key) do nothing;

  -- Seed scheduling defaults (settings + baseline compliance rules). Idempotent.
  perform public.seed_default_scheduling_config(v_facility_id);

  -- Seed the standard daily-report Operations Checklists catalog. Idempotent.
  perform public.seed_default_daily_report_checklists(v_facility_id);

  return v_facility_id;
end;
$$;

comment on function public.create_facility_with_roles(text, text, text, text, text, text) is
  'Atomically creates a facility, seeds its six canonical system roles, default scheduling config, and the standard daily-report checklist catalog. Restricted to platform super_admins. Returns the new facility UUID.';

-- -----------------------------------------------------------------------------
-- Backfill: facilities with no daily-report areas at all get the catalog.
-- -----------------------------------------------------------------------------
do $$
declare
  v_row record;
begin
  for v_row in
    select f.id
      from public.facilities f
     where not exists (
       select 1 from public.daily_report_areas a where a.facility_id = f.id
     )
  loop
    perform public.seed_default_daily_report_checklists(v_row.id);
  end loop;
end$$;
