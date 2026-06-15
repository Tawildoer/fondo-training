const EVENT_LABELS = {
  gran_fondo: 'Gran Fondo',
  sportive: 'Sportive',
  road_race: 'Road race',
  criterium: 'Criterium',
  time_trial: 'Time trial',
  other: 'Event',
}

function Section({ icon, title, children }) {
  return (
    <div className="card">
      <h2>
        <i className={`ti ${icon}`} style={{ marginRight: 7, fontSize: 13, verticalAlign: 'middle' }} aria-hidden="true" />
        {title}
      </h2>
      {children}
    </div>
  )
}

function Tip({ children }) {
  return (
    <div className="tip-box" style={{ marginBottom: 12 }}>
      <i className="ti ti-bulb" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

function Row({ label, value, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '0.5px solid var(--color-border)', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: muted ? 400 : 500, textAlign: 'right', color: muted ? 'var(--color-text-muted)' : 'var(--color-text)' }}>{value}</span>
    </div>
  )
}

export default function Nutrition({ user }) {
  const { event_type, event_distance_km, event_name } = user
  const distKm = parseInt(event_distance_km) || 0
  const eventLabel = EVENT_LABELS[event_type] || 'Event'

  const isEndurance = ['gran_fondo', 'sportive', 'other'].includes(event_type)
  const isShortIntense = ['criterium', 'road_race'].includes(event_type)
  const isTT = event_type === 'time_trial'

  const isLong = distKm >= 100 || (!distKm && isEndurance)
  const isVeryLong = distKm >= 160

  // Per-hour carb target
  let carbsPerHour, carbNote
  if (isShortIntense) {
    carbsPerHour = '40–60g'
    carbNote = 'Short intense events burn through glycogen fast. Aim for the high end if racing for more than 60 minutes.'
  } else if (isTT) {
    carbsPerHour = '40–60g'
    carbNote = 'TTs are high intensity throughout — even a 30-minute effort benefits from a pre-race gel.'
  } else if (isVeryLong) {
    carbsPerHour = '80–90g'
    carbNote = `For a ${distKm}km event, your gut will be working hard. Train with 90g/hr in the months before so your gut can absorb it reliably on race day.`
  } else {
    carbsPerHour = '60–80g'
    carbNote = isLong ? 'Mix glucose and fructose sources (e.g. gels + energy drink) to absorb the full 80g/hr without GI issues.' : 'Aim for around 60g/hr. One gel every 30 minutes plus an electrolyte drink works well.'
  }

  const carbLoadDays = isVeryLong ? '2–3' : isLong ? '1–2' : '1'

  return (
    <div>
      {/* Header summary */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="val">{carbsPerHour}</div>
          <div className="lbl">Carbs/hour</div>
        </div>
        <div className="stat-card">
          <div className="val">{isLong ? '3–4 hrs' : '2–3 hrs'}</div>
          <div className="lbl">Pre-race meal</div>
        </div>
        <div className="stat-card">
          <div className="val">{carbLoadDays} day{carbLoadDays !== '1' ? 's' : ''}</div>
          <div className="lbl">Carb load</div>
        </div>
        <div className="stat-card">
          <div className="val">500–750ml</div>
          <div className="lbl">Per hour fluid</div>
        </div>
      </div>

      {/* Pre-race meal */}
      <Section icon="ti-sunrise" title="Pre-race meal">
        <Tip>
          {isLong
            ? `For a ${distKm ? distKm + 'km' : 'long'} event, eat a substantial carb-rich meal 3–4 hours before the start. Don't try anything new on race day.`
            : `Eat 2–3 hours before the start — enough time to digest without feeling sluggish. Keep it familiar.`}
        </Tip>
        <Row label="Timing" value={isLong ? '3–4 hours before start' : '2–3 hours before start'} />
        <Row label="Target carbs" value={isLong ? '2–3g per kg bodyweight' : '1–2g per kg bodyweight'} />
        <Row label="Good options" value="Porridge/oats, rice, pasta, toast with jam, banana" />
        <Row label="Avoid" value="High fibre, high fat, very spicy — anything that might cause GI issues" />
        {isLong && (
          <Row label="2 hours before" value="Add a small snack: banana or rice cake. Top off glycogen stores." />
        )}
        <Row label="30 min before" value="Gel or sports drink to top off blood glucose — especially on a cold morning" />
      </Section>

      {/* Carb loading */}
      {isLong && (
        <Section icon="ti-stack" title="Carb loading">
          <Tip>
            {isVeryLong
              ? `For ${distKm ? distKm + 'km+' : 'very long'} events, proper carb loading over 2–3 days can meaningfully extend your performance in the final third of the race.`
              : 'A light carb load the day before boosts glycogen stores by ~10–15%. Focus on quality carbs, not just volume.'}
          </Tip>
          <Row label="Start loading" value={isVeryLong ? '3 days before' : '2 days before'} />
          <Row label="Daily carb target" value={isVeryLong ? '8–10g per kg bodyweight' : '7–8g per kg bodyweight'} />
          <Row label="Good sources" value="White rice, pasta, bread, potatoes, bananas, sports drinks" />
          <Row label="Reduce fibre" value="Cut down on vegetables, legumes, wholegrain on these days" />
          <Row label="Protein & fat" value="Eat as normal — don't overeat overall, just shift the ratio toward carbs" />
          {isVeryLong && (
            <Row label="Hydration link" value="More carbs means your body stores more water too — you may weigh 1–2kg more. This is normal and good." />
          )}
        </Section>
      )}

      {!isLong && (
        <Section icon="ti-stack" title="Pre-race carb strategy">
          <Tip>
            {isShortIntense
              ? 'For a criterium or road race, glycogen loading isn\'t critical — your pre-race meal and a gel before the start does the job.'
              : 'Top off carbs the evening before with a larger-than-usual carb-rich meal. Keep it simple.'}
          </Tip>
          <Row label="Evening before" value="Larger carb meal: pasta, rice, potato with a moderate protein portion" />
          <Row label="Morning of" value="Your normal pre-race meal. Avoid high-fibre food." />
          <Row label="Warm-up gel" value="Take a gel 15 minutes before the start. This lifts blood glucose right as you need it." />
        </Section>
      )}

      {/* On-bike nutrition */}
      <Section icon="ti-droplet" title={`On-bike fuelling — ${carbsPerHour} carbs/hour`}>
        <Tip>{carbNote}</Tip>
        {isEndurance && (
          <>
            <Row label="Mix sources" value="Combine glucose (gels, chews) + fructose (energy drink, dates) to absorb more than 60g/hr" />
            <Row label="Eat early" value="Start fuelling in the first 20 minutes, even if you feel fine. Don't wait until hungry." />
          </>
        )}
        {isShortIntense && (
          <>
            <Row label="Before attacks" value="If you can predict hard efforts (climbs, sprint finishes), consume carbs 10 min before" />
            <Row label="Bottles" value="Carry electrolyte drink even in short races — 1 bottle per hour is a useful target" />
          </>
        )}
        {isTT && (
          <>
            <Row label="Strategy" value="Pre-load with a gel 5 min before start. For TTs over 40 min, take another at halfway." />
            <Row label="Aero note" value="Eating in a TT aero position is awkward — practice it in training to avoid fumbling on race day" />
          </>
        )}
        <Row label="Every 20–30 min" value="1 gel (22–25g carbs) or 500ml energy drink (30–40g carbs)" />
        {distKm >= 120 && (
          <Row label="Real food" value="For very long events, solid food (rice cakes, banana, flapjack) is easier on the gut than gels alone" />
        )}
        <Row label="Caffeine" value="Caffeinated gels are effective. Save them for the final third or when concentration is dropping." />
      </Section>

      {/* Hydration */}
      <Section icon="ti-droplets" title="Hydration">
        <div className="tip-box" style={{ marginBottom: 12 }}>
          <i className="ti ti-thermometer" style={{ flexShrink: 0 }} aria-hidden="true" />
          <span>Fluid needs vary with temperature. On hot days, increase to 750–1000ml/hr. In cold conditions, it's easy to forget to drink — set a reminder every 15 minutes.</span>
        </div>
        <Row label="Target" value="500–750ml per hour on the bike" />
        <Row label="Electrolytes" value="Always add sodium to your bottles — a pinch of salt or electrolyte tabs. Prevents hyponatremia and cramps on long events." />
        <Row label="Pre-race" value="2–3 hours before: 500ml water. 30 min before: 250–500ml with electrolytes." />
        <Row label="Post-race" value="Drink 1.5x the fluid you estimate you lost (check weight before/after in training to calibrate)" />
        <Row label="Urine colour" value="Pale straw = well hydrated. Dark yellow = drink more. Clear = overdoing it." />
        {isVeryLong && (
          <Row label="Aid stations" value={`For ${distKm}km+, plan which aid stations you'll use. Know what they offer so you don't pick up something unfamiliar mid-race.`} />
        )}
      </Section>

      {/* Gut training */}
      <Section icon="ti-run" title="Gut training">
        <Tip>
          Your gut is trainable. Practice eating on the bike in training — especially during long Z2 rides — so your stomach learns to absorb carbs at race pace.
        </Tip>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              icon: 'ti-repeat',
              title: 'Train with race nutrition',
              desc: `Use the exact gels, drinks, and bars you plan to race with in your long rides. Don't leave this to race week.${isEndurance ? ' For gran fondos, your Saturday long rides are the perfect practice ground.' : ''}`,
            },
            {
              icon: 'ti-trending-up',
              title: 'Build carb tolerance',
              desc: `Start at 40–50g/hr in training and progressively increase toward your ${carbsPerHour} race target over the coming weeks. Your gut adapts to higher rates with practice.`,
            },
            {
              icon: 'ti-alert-triangle',
              title: 'Never try new food on race day',
              desc: 'If a sponsor provides unfamiliar nutrition at race expo, keep it for training. Use only what your gut has tested at race intensity.',
            },
          ].map(tip => (
            <div key={tip.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '0.5px solid var(--color-border)' }}>
              <i className={`ti ${tip.icon}`} style={{ fontSize: 18, color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{tip.title}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{tip.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
