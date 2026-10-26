-- KasiFlow SA — EXTRA fictional demo data for the existing demo shop "Thato's Barber Studio".
--
-- Adds, without touching today's cash figures or the cash-flow forecast story:
--   * the regular customers to the customer list (fictional names and +27 00 000 numbers)
--   * about nine more months of appointment-book visits (91–364 days ago), including house calls
--   * walk-in queue history (31–150 days ago) so the walk-in share and average queue wait fill in
--   * confirmed bookings for the rest of today and the next 7 days, and more requests waiting for an answer
-- Every row is invented. Runs once per demo shop: a second run does nothing (rebuild with `demo-users` to start over).
--
-- Usage: dotnet run -- demo-more     (or psql -v business_id=<uuid> -f database/seed/demo_more.sql)

CREATE TEMP TABLE IF NOT EXISTS kasiflow_more_params (business_id uuid NOT NULL);
TRUNCATE kasiflow_more_params;
INSERT INTO kasiflow_more_params VALUES (:'business_id');

DO $$
DECLARE
    b uuid := (SELECT business_id FROM kasiflow_more_params LIMIT 1);
    tz text := 'Africa/Johannesburg';
    d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    marker text := 'Extra demo data';
    v_user uuid; br uuid;
    st_thato uuid; st_bongani uuid; st_ayanda uuid; st_neo uuid;
    sv_cut uuid; sv_fade uuid; sv_beard uuid; sv_lineup uuid; sv_wash uuid; sv_combo uuid; sv_kids uuid;
    names text[] := ARRAY['Sipho M.','Lerato K.','Kabelo D.','Thabo N.','Karabo S.','Lwazi M.','Mpho R.','Tshepo L.','Bongani K.','Andile Z.','Katlego P.','Neo M.','Themba G.','Kagiso P.','Mandla Z.','Tumi N.','Vusi B.','Sello T.','Jabu C.','Lebo F.','Musa H.','Kamo V.','Tebogo W.','Dumi X.','Ofentse Y.'];
    suburbs text[] := ARRAY['Orlando West','Dube','Meadowlands','Diepkloof','Pimville','Jabavu','Protea Glen','Naledi'];
    hd date; hh int; hm int; hs uuid; hsv uuid; hcust int; hstatus text; hk int; bk uuid; house boolean;
    k int; tickets int; joined timestamptz; started timestamptz; wait int; dur int; price int; sname text;
    slot time; starts timestamptz;
BEGIN
    IF b IS NULL OR NOT EXISTS (SELECT 1 FROM businesses WHERE id = b AND is_demo = TRUE) THEN
        RAISE EXCEPTION 'Only a demo business can receive extra demo data.';
    END IF;
    IF EXISTS (SELECT 1 FROM bookings WHERE business_id = b AND internal_note = marker) THEN
        RAISE NOTICE 'Extra demo data is already loaded for this shop; nothing to do.';
        RETURN;
    END IF;

    SELECT user_id INTO v_user FROM business_members WHERE business_id = b AND role = 'owner' ORDER BY created_at LIMIT 1;
    SELECT id INTO br FROM branches WHERE business_id = b ORDER BY created_at LIMIT 1;
    SELECT id INTO st_thato FROM staff_profiles WHERE business_id = b AND display_name LIKE 'Thato%' LIMIT 1;
    SELECT id INTO st_bongani FROM staff_profiles WHERE business_id = b AND display_name LIKE 'Bongani%' LIMIT 1;
    SELECT id INTO st_ayanda FROM staff_profiles WHERE business_id = b AND display_name LIKE 'Ayanda%' LIMIT 1;
    SELECT id INTO st_neo FROM staff_profiles WHERE business_id = b AND display_name LIKE 'Neo%' LIMIT 1;
    SELECT id INTO sv_cut FROM services WHERE business_id = b AND name = 'Haircut';
    SELECT id INTO sv_fade FROM services WHERE business_id = b AND name = 'Fade';
    SELECT id INTO sv_beard FROM services WHERE business_id = b AND name = 'Beard trim';
    SELECT id INTO sv_lineup FROM services WHERE business_id = b AND name = 'Line-up';
    SELECT id INTO sv_wash FROM services WHERE business_id = b AND name = 'Wash and styling';
    SELECT id INTO sv_combo FROM services WHERE business_id = b AND name = 'Haircut and beard combo';
    SELECT id INTO sv_kids FROM services WHERE business_id = b AND name = 'Kids cut (under 12)';
    IF st_thato IS NULL OR st_bongani IS NULL OR st_ayanda IS NULL OR st_neo IS NULL OR sv_fade IS NULL THEN
        RAISE EXCEPTION 'The demo shop is missing its barbers or services; rebuild it with demo-users first.';
    END IF;

    -- 1. Regular customers on the customer list (names match the appointment-book history, so repeat visits line up).
    INSERT INTO customers (business_id, name, phone, notes)
    SELECT b, u.n || ' (fictional)', '+27 00 000 1' || lpad(u.i::text, 3, '0'), 'Regular (demo)'
    FROM unnest(names) WITH ORDINALITY AS u(n, i)
    WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id = b AND c.name = u.n || ' (fictional)');

    -- 2. Nine more months of the appointment book (91–364 days ago). No payments are linked (the takings are in the
    --    older weekly sales already recorded), so these are 'history' visits, like the seed's last 90 days.
    FOR hk IN 1..1300 LOOP
        hd := d - (91 + floor(random() * 274))::int;
        CONTINUE WHEN random() > (ARRAY[0.25, 0.45, 0.45, 0.5, 0.6, 0.95, 1.0])[extract(dow FROM hd)::int + 1];
        hh := (ARRAY[9, 10, 10, 11, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18])[1 + floor(random() * 15)::int];
        CONTINUE WHEN extract(dow FROM hd) = 0 AND hh >= 14;
        hs := (ARRAY[st_thato, st_bongani, st_bongani, st_ayanda, st_ayanda, st_neo])[1 + floor(random() * 6)::int];
        CONTINUE WHEN hs = st_neo AND hh < 14;
        hsv := (ARRAY[sv_cut, sv_cut, sv_fade, sv_fade, sv_fade, sv_beard, sv_lineup, sv_combo, sv_combo, sv_kids, sv_wash])[1 + floor(random() * 11)::int];
        hcust := 1 + floor(power(random(), 1.6) * 25)::int;
        hstatus := CASE WHEN random() < 0.05 THEN 'no_show' ELSE 'completed' END;
        hm := (floor(random() * 4) * 15)::int;
        house := hs IN (st_ayanda, st_thato) AND hsv <> sv_wash AND random() < 0.12;
        INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, location_type, starts_at, ends_at, status,
            services_total_cents, travel_fee_cents, total_cents, source, completed_at, created_by, internal_note)
        SELECT b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), names[hcust] || ' (fictional)', '+27 00 000 1' || lpad(hcust::text, 3, '0'), hs, br,
               CASE WHEN house THEN 'house_call' ELSE 'in_shop' END,
               (hd + make_time(hh, hm, 0)) AT TIME ZONE tz,
               (hd + make_time(hh, hm, 0)) AT TIME ZONE tz + make_interval(mins => sv.duration_minutes),
               hstatus, sv.price_cents, CASE WHEN house THEN 10000 ELSE 0 END, sv.price_cents + CASE WHEN house THEN 10000 ELSE 0 END,
               'history', CASE WHEN hstatus = 'completed' THEN (hd + time '19:00') AT TIME ZONE tz END, v_user, marker
        FROM services sv WHERE sv.id = hsv
        RETURNING id INTO bk;
        INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes)
        SELECT b, bk, sv.id, sv.name, sv.price_cents, sv.duration_minutes FROM services sv WHERE sv.id = hsv;
        IF house THEN
            INSERT INTO house_call_details (booking_id, business_id, address_line, suburb, town, distance_km, distance_source)
            VALUES (bk, b, (10 + hcust) || ' Example Street (fictional)', suburbs[1 + floor(random() * 8)::int], 'Soweto', round((2 + random() * 10)::numeric, 1), 'manual');
        END IF;
    END LOOP;

    -- 3. Walk-in queue history (31–150 days ago, so no recent visit lacks its payment): numbered tickets that went
    --    waiting → in the chair → done, each finished as a completed 'walkin' visit.
    FOR k IN 31..150 LOOP
        hd := d - k;
        CONTINUE WHEN extract(dow FROM hd) = 0;
        tickets := floor(random() * (CASE WHEN extract(dow FROM hd) IN (5, 6) THEN 6 ELSE 3 END))::int;
        FOR hk IN 1..tickets LOOP
            hh := 9 + floor(random() * 8)::int;
            hm := (floor(random() * 4) * 15)::int;
            hs := (ARRAY[st_thato, st_bongani, st_bongani, st_ayanda])[1 + floor(random() * 4)::int];
            hsv := (ARRAY[sv_cut, sv_fade, sv_fade, sv_lineup, sv_beard, sv_kids])[1 + floor(random() * 6)::int];
            hcust := 1 + floor(power(random(), 1.4) * 25)::int;
            SELECT duration_minutes, price_cents, name INTO dur, price, sname FROM services WHERE id = hsv;
            wait := 5 + floor(random() * 35)::int;
            joined := (hd + make_time(hh, hm, 0)) AT TIME ZONE tz;
            started := joined + make_interval(mins => wait);
            INSERT INTO bookings (business_id, reference, customer_name, staff_id, branch_id, starts_at, ends_at, status,
                services_total_cents, total_cents, source, completed_at, created_by, internal_note)
            VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), split_part(names[hcust], ' ', 1) || ' (walk-in, fictional)', hs, br,
                started, started + make_interval(mins => dur), 'completed', price, price, 'walkin', started + make_interval(mins => dur), v_user, marker)
            RETURNING id INTO bk;
            INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes)
            VALUES (b, bk, hsv, sname, price, dur);
            INSERT INTO walkin_tickets (business_id, branch_id, ticket_date, number, customer_name, service_ids, services_summary, est_minutes,
                staff_id, status, joined_at, called_at, started_at, finished_at, booking_id, source, created_by)
            VALUES (b, br, hd, hk, split_part(names[hcust], ' ', 1) || ' (fictional)', ARRAY[hsv], sname, dur,
                hs, 'done', joined, started - interval '2 minutes', started, started + make_interval(mins => dur), bk, 'desk', v_user);
        END LOOP;
    END LOOP;

    -- 4. Confirmed bookings for the rest of today and the next 7 days (skipping any slot that would overlap a barber's
    --    existing confirmed booking, Neo's mornings, Sunday afternoons, Neo's exam day and Bongani's course afternoon).
    FOR k IN 0..7 LOOP
        hd := d + k;
        FOREACH slot IN ARRAY ARRAY[time '09:00', time '10:30', time '12:00', time '14:30', time '15:30', time '16:30'] LOOP
            FOREACH hs IN ARRAY ARRAY[st_thato, st_bongani, st_ayanda, st_neo] LOOP
                CONTINUE WHEN random() > CASE WHEN extract(dow FROM hd) IN (5, 6) THEN 0.7 ELSE 0.4 END;
                CONTINUE WHEN hs = st_neo AND (slot < time '14:00' OR k = 3);
                CONTINUE WHEN extract(dow FROM hd) = 0 AND slot >= time '14:00';
                CONTINUE WHEN hs = st_bongani AND k = 1 AND slot >= time '12:00';
                hsv := (ARRAY[sv_cut, sv_fade, sv_fade, sv_combo, sv_beard, sv_lineup, sv_kids])[1 + floor(random() * 7)::int];
                hcust := 1 + floor(random() * 25)::int;
                SELECT duration_minutes, price_cents, name INTO dur, price, sname FROM services WHERE id = hsv;
                starts := (hd + slot) AT TIME ZONE tz;
                CONTINUE WHEN EXISTS (SELECT 1 FROM bookings x WHERE x.staff_id = hs AND x.status = 'confirmed'
                                      AND tstzrange(x.starts_at, x.ends_at) && tstzrange(starts, starts + make_interval(mins => dur)));
                INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status,
                    services_total_cents, total_cents, source, confirmed_by, confirmed_at, created_by, internal_note)
                VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), names[hcust] || ' (fictional)', '+27 00 000 1' || lpad(hcust::text, 3, '0'),
                    hs, br, starts, starts + make_interval(mins => dur), 'confirmed', price, price,
                    CASE WHEN random() < 0.5 THEN 'public' ELSE 'staff' END, v_user, now() - interval '1 day', v_user, marker)
                RETURNING id INTO bk;
                INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes)
                VALUES (b, bk, hsv, sname, price, dur);
                INSERT INTO booking_events (business_id, booking_id, event, to_status, actor_kind, actor_user_id)
                VALUES (b, bk, 'confirmed', 'confirmed', 'staff', v_user);
            END LOOP;
        END LOOP;
    END LOOP;

    -- 5. Three more requests from the public booking page, waiting for the shop to confirm.
    FOR k IN 1..3 LOOP
        hsv := (ARRAY[sv_fade, sv_combo, sv_kids])[k];
        hs := (ARRAY[st_ayanda, st_thato, st_ayanda])[k];
        SELECT duration_minutes, price_cents, name INTO dur, price, sname FROM services WHERE id = hsv;
        starts := ((d + k + 1) + time '11:15') AT TIME ZONE tz;
        INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status,
            services_total_cents, total_cents, source, customer_note, internal_note)
        VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), (ARRAY['Ofentse Y.', 'Musa H.', 'Lebo F.'])[k] || ' (fictional)',
            '+27 00 000 2' || lpad(k::text, 3, '0'), hs, br, starts, starts + make_interval(mins => dur), 'requested', price, price, 'public',
            (ARRAY['Can you do a low fade?', 'Birthday on Saturday.', 'For my son, he is 8.'])[k], marker)
        RETURNING id INTO bk;
        INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes)
        VALUES (b, bk, hsv, sname, price, dur);
        INSERT INTO booking_events (business_id, booking_id, event, to_status, actor_kind, note)
        VALUES (b, bk, 'requested', 'requested', 'customer', 'Requested through the public booking page.');
    END LOOP;
END $$;
