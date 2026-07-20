// Ekoquick Pricing Engine — the single source of truth for every delivery
// quote. Every price shown to a customer, every driver earning, and every
// commission figure must be produced by calculateQuote() below, reading
// config from the pricing_* tables (editable from Admin > Pricing Engine).
// No price should ever be hardcoded outside this file.
//
// Usage:
//   await PricingEngine.load();                 // once per page load
//   const q = PricingEngine.calculateQuote({...}); // as many times as needed

const PricingEngine = (function () {
    let cfg = null;
    let loadPromise = null;

    async function load(force) {
        if (cfg && !force) return cfg;
        if (loadPromise && !force) return loadPromise;

        loadPromise = (async () => {
            const [vehiclesRes, distanceRes, weightRes, categoriesRes, trafficRes, routeRes, priorityRes, settingsRes] = await Promise.all([
                supabase.from('pricing_vehicles').select('*').eq('status', 'active').order('sort_order'),
                supabase.from('pricing_distance_bands').select('*').order('sort_order'),
                supabase.from('pricing_weight_bands').select('*').order('sort_order'),
                supabase.from('pricing_parcel_categories').select('*').order('sort_order'),
                supabase.from('pricing_traffic_multipliers').select('*').order('sort_order'),
                supabase.from('pricing_route_difficulty').select('*').order('sort_order'),
                supabase.from('pricing_priority_levels').select('*').order('sort_order'),
                supabase.from('settings').select('*'),
            ]);

            const settingsMap = {};
            (settingsRes.data || []).forEach(function (s) { settingsMap[s.key] = s.value; });

            cfg = {
                vehicles: vehiclesRes.data || [],
                distanceBands: distanceRes.data || [],
                weightBands: weightRes.data || [],
                categories: categoriesRes.data || [],
                traffic: trafficRes.data || [],
                routeTypes: routeRes.data || [],
                priorities: priorityRes.data || [],
                settings: settingsMap,
            };
            return cfg;
        })();

        return loadPromise;
    }

    function getSetting(key, fallback) {
        if (!cfg || cfg.settings[key] === undefined) return fallback;
        const v = parseFloat(cfg.settings[key]);
        return isNaN(v) ? fallback : v;
    }

    function findBand(bands, value, minKey, maxKey) {
        for (const b of bands) {
            const min = parseFloat(b[minKey]);
            const max = b[maxKey] === null || b[maxKey] === undefined ? Infinity : parseFloat(b[maxKey]);
            if (value >= min && value < max) return b;
        }
        return bands[bands.length - 1] || null;
    }

    function fuelAdjustedRate(vehicle) {
        const isDiesel = vehicle.fuel_type === 'diesel';
        const current = getSetting(isDiesel ? 'pricing_fuel_diesel_price' : 'pricing_fuel_petrol_price', null);
        const base = getSetting(isDiesel ? 'pricing_fuel_base_diesel_price' : 'pricing_fuel_base_petrol_price', null);
        const sensitivity = getSetting('pricing_fuel_adjustment_sensitivity', 0);
        if (current === null || base === null || base === 0 || vehicle.fuel_type === 'electric') {
            return parseFloat(vehicle.price_per_km);
        }
        const pctChange = (current - base) / base;
        return parseFloat(vehicle.price_per_km) * (1 + sensitivity * pctChange);
    }

    // input: { vehicleId, distanceKm, durationSeconds, weightKg, parcelCategory,
    //          extraStops, waitingMinutes, priority, trafficLevel, routeType,
    //          promoCode, promo, corporateDiscount }
    // promo / corporateDiscount may be passed in directly (already-looked-up
    // rows) to avoid an extra DB round trip inside this pure function.
    function calculateQuote(input) {
        if (!cfg) throw new Error('PricingEngine.load() must be called before calculateQuote()');

        const vehicle = cfg.vehicles.find(function (v) { return v.vehicle_id === input.vehicleId; });
        if (!vehicle) throw new Error('Unknown or inactive vehicle: ' + input.vehicleId);

        const distanceKm = Math.max(0, Number(input.distanceKm) || 0);
        const weightKg = Math.max(0, Number(input.weightKg) || 0);
        const extraStops = Math.min(Math.max(0, Number(input.extraStops) || 0), getSetting('pricing_extra_stop_max', 5));
        const waitingMinutes = Math.max(0, Number(input.waitingMinutes) || 0);

        const distanceBand = findBand(cfg.distanceBands, distanceKm, 'min_km', 'max_km');
        const weightBand = findBand(cfg.weightBands, weightKg, 'min_kg', 'max_kg');
        const category = cfg.categories.find(function (c) { return c.category === input.parcelCategory; }) || null;
        const traffic = cfg.traffic.find(function (t) { return t.level === input.trafficLevel; }) || { multiplier: 1, level: 'light' };
        const route = cfg.routeTypes.find(function (r) { return r.route_type === input.routeType; }) || { multiplier: 1, route_type: 'urban' };
        const priorityRow = cfg.priorities.find(function (p) { return p.level === input.priority; }) || { multiplier: 1, level: 'normal' };

        const baseFare = parseFloat(vehicle.base_fare);
        const effectiveRate = fuelAdjustedRate(vehicle) * (distanceBand ? parseFloat(distanceBand.rate_multiplier) : 1);
        const distanceCharge = distanceKm * effectiveRate;

        const weightMultiplier = weightBand ? parseFloat(weightBand.multiplier) : 1;
        const weightCharge = (baseFare + distanceCharge) * (weightMultiplier - 1);

        const handlingFee = category ? parseFloat(category.handling_fee) : 0;

        let runningSubtotal = baseFare + distanceCharge + weightCharge + handlingFee;

        const trafficAdjustment = runningSubtotal * (parseFloat(traffic.multiplier) - 1);
        runningSubtotal += trafficAdjustment;

        const routeAdjustment = runningSubtotal * (parseFloat(route.multiplier) - 1);
        runningSubtotal += routeAdjustment;

        const freeMinutes = getSetting('pricing_waiting_free_minutes', 10);
        const chargePerMin = getSetting('pricing_waiting_charge_per_min', 2);
        const maxWaitingCharge = getSetting('pricing_waiting_max_charge', 100);
        const waitingCharge = Math.min(Math.max(0, waitingMinutes - freeMinutes) * chargePerMin, maxWaitingCharge);

        const extraStopChargeEach = parseFloat(vehicle.extra_stop_charge) || getSetting('pricing_extra_stop_price', 20);
        const extraStopsCharge = extraStops * extraStopChargeEach;

        const prioritySurcharge = runningSubtotal * ((parseFloat(priorityRow.multiplier) * parseFloat(vehicle.priority_multiplier || 1)) - 1);
        runningSubtotal += prioritySurcharge;

        let subtotal = runningSubtotal + waitingCharge + extraStopsCharge;
        subtotal = Math.max(subtotal, parseFloat(vehicle.minimum_fare) || 0);

        const insurancePct = category ? parseFloat(category.insurance_pct) : 0;
        const insuranceCharge = subtotal * (insurancePct / 100);
        subtotal += insuranceCharge;

        // Discount: either a promo code or a corporate discount, not both.
        let discount = 0;
        let discountLabel = null;
        if (input.promo && input.promo.active) {
            if (input.promo.discount_type === 'percentage') discount = subtotal * (parseFloat(input.promo.discount_value) / 100);
            else if (input.promo.discount_type === 'fixed') discount = parseFloat(input.promo.discount_value);
            else if (input.promo.discount_type === 'free_delivery') discount = subtotal;
            discountLabel = 'Promo: ' + input.promo.code;
        } else if (input.corporateDiscount && input.corporateDiscount.active) {
            discount = subtotal * (parseFloat(input.corporateDiscount.discount_pct) / 100);
            discountLabel = 'Corporate rate: ' + input.corporateDiscount.label;
        }
        discount = Math.min(discount, subtotal);

        const afterDiscount = subtotal - discount;

        const vatEnabled = getSetting('pricing_vat_enabled', 0) === 1 || cfg.settings.pricing_vat_enabled === 'true';
        const vatPct = getSetting('pricing_vat_pct', 15);
        const vat = vatEnabled ? afterDiscount * (vatPct / 100) : 0;

        const customerTotal = Math.round((afterDiscount + vat) * 100) / 100;

        // Driver earns their commission % of the delivery-effort portion of the
        // fare (base + distance + weight + traffic/route/priority adjustments +
        // waiting + extra stops). Handling fee, insurance, and VAT are kept by
        // the platform in full — they cover packaging/risk/tax, not driving.
        const driverableAmount = baseFare + distanceCharge + weightCharge + trafficAdjustment + routeAdjustment + prioritySurcharge + waitingCharge + extraStopsCharge;
        const driverCommissionPct = parseFloat(vehicle.driver_commission_pct) / 100;
        const driverEarnings = Math.round(driverableAmount * driverCommissionPct * 100) / 100;
        const platformCommission = Math.round((customerTotal - driverEarnings) * 100) / 100;

        return {
            vehicleId: vehicle.vehicle_id,
            vehicleLabel: vehicle.label,
            distanceKm: distanceKm,
            estimatedDuration: input.durationLabel || null,
            baseFare: round2(baseFare),
            distanceCharge: round2(distanceCharge),
            weightCharge: round2(weightCharge),
            handlingFee: round2(handlingFee),
            trafficAdjustment: round2(trafficAdjustment),
            routeAdjustment: round2(routeAdjustment),
            waitingCharge: round2(waitingCharge),
            extraStopsCharge: round2(extraStopsCharge),
            prioritySurcharge: round2(prioritySurcharge),
            insuranceCharge: round2(insuranceCharge),
            subtotal: round2(subtotal),
            discount: round2(discount),
            discountLabel: discountLabel,
            vatEnabled: vatEnabled,
            vatPct: vatPct,
            vat: round2(vat),
            customerTotal: customerTotal,
            driverEarnings: driverEarnings,
            platformCommission: platformCommission,
            requiresSignature: category ? category.requires_signature : false,
            requiresOtp: category ? category.requires_otp : true,
            requiresPhoto: category ? category.requires_photo : false,
            trafficLevel: traffic.level,
            routeType: route.route_type,
            priority: priorityRow.level,
            calculatedAt: new Date().toISOString(),
        };
    }

    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    return { load: load, calculateQuote: calculateQuote, getConfig: function () { return cfg; } };
})();
