// Homepage v2 — dark, security-first, animated. Everything self-hosted and
// CSP-safe; WebGL/canvas effects degrade gracefully.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PublicApi } from '../api.js'
import { Icon } from '../components/Icon.jsx'
import { LogoMark } from '../components/Logo.jsx'
import { MoneyCounter } from '../components/MoneyCounter.jsx'
import { inrCompact } from '../format.js'
import { useAuth } from '../ctx/AuthContext.jsx'
import CursorGrid from '../reactbits/CursorGrid.jsx'
import LogoLoop from '../reactbits/LogoLoop.jsx'
import Particles from '../reactbits/Particles.jsx'
import PillNav from '../reactbits/PillNav.jsx'
import RotatingText from '../reactbits/RotatingText.jsx'
import ScrollFloat from '../reactbits/ScrollFloat.jsx'
import ScrollReveal from '../reactbits/ScrollReveal.jsx'
import SpecularButton from '../reactbits/SpecularButton.jsx'
import VariableProximity from '../reactbits/VariableProximity.jsx'
import './landing.css'

const NAV_ITEMS = [
  { label: 'How it works', href: '#how' },
  { label: 'Security', href: '#security' },
  { label: 'Live', href: '#live' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Sign in', href: '/login' },
]

const ROTATING_CAUSES = ['education', 'medical care', 'your community',
                         'emergencies', 'creative work', 'non-profits']

const STEPS = [
  {
    icon: 'qr', num: '01', title: 'Create',
    body: 'Tell your story, set a goal, upload your UPI QR. Live in five minutes.',
  },
  {
    icon: 'share', num: '02', title: 'Share',
    body: 'One clean link. Supporters scan and pay you directly.',
  },
  {
    icon: 'badge-check', num: '03', title: 'Verify',
    body: 'Confirm each payment yourself. Verified names join your wall.',
  },
]

const SECURITY_ITEMS = [
  { icon: 'lock', title: 'Encrypted in transit', body: 'TLS everywhere, HSTS enforced.' },
  { icon: 'shield', title: 'Hardened accounts', body: 'Argon2id hashing, locked-down sessions.' },
  { icon: 'eye', title: 'Private proof vault', body: 'Screenshots visible only to you.' },
  { icon: 'zap', title: 'Abuse throttling', body: 'Layered rate limits at every door.' },
  { icon: 'badge-check', title: 'Human verification', body: 'No payment trusted automatically.' },
  { icon: 'users', title: 'Data minimalism', body: 'No supporter accounts. Nothing sold.' },
]

const FAQS = [
  { q: 'Does CrowdFund charge any fees?',
    a: 'No. Payments never pass through us, so there is nothing to take. 0%.' },
  { q: 'How does the money reach me?',
    a: 'Supporters scan your own UPI QR and pay you directly, app to app.' },
  { q: 'How does verification work?',
    a: 'A supporter submits their transaction ID or screenshot. You match it against your statement and confirm — only then do they appear on the wall.' },
  { q: 'Do supporters need an account?',
    a: 'No. They pay, submit proof, and get a reference code to track it.' },
  { q: 'Can I run more than one fundraiser?',
    a: 'Yes — unlimited, each with its own page, QR, analytics and exports.' },
  { q: 'What about payment gateways?',
    a: 'QR-first keeps it free and instant. Gateway support is planned as an optional add-on.' },
]

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const heroTitleRef = useRef(null)
  const [live, setLive] = useState(null)

  useEffect(() => {
    PublicApi.index()
      .then(setLive)
      .catch(() => setLive({ campaigns: [], stats: null }))
  }, [])

  const campaigns = live?.campaigns || []
  const stats = live?.stats

  return (
    <div className="lp">
      <PillNav
        logo="/favicon.svg"
        logoAlt="CrowdFund"
        items={NAV_ITEMS}
        activeHref="/"
        baseColor="#0b0e1a"
        pillColor="#f2f4fa"
        hoveredPillTextColor="#f2f4fa"
        pillTextColor="#0b0e1a"
      />

      {/* ------------------------------------------------------------ hero */}
      <header className="lp-hero">
        <Particles
          className="lp-hero-particles"
          particleColors={['#6366f1', '#34d399', '#a5b4fc', '#ffffff']}
          particleCount={240}
          particleSpread={11}
          speed={0.08}
          particleBaseSize={90}
          moveParticlesOnHover
          particleHoverFactor={0.6}
          alphaParticles
          disableRotation={false}
        />
        <div className="lp-container lp-hero-inner" ref={heroTitleRef}>
          <div className="lp-hero-copy">
            <p className="lp-badge">
              <Icon name="shield" size={13} />
              Direct-to-account payments · Zero platform fees
            </p>
            <h1 className="lp-title">
              <VariableProximity
                label="Raise funds directly. Keep every rupee."
                fromFontVariationSettings="'wght' 650"
                toFontVariationSettings="'wght' 900"
                containerRef={heroTitleRef}
                radius={110}
                falloff="linear"
              />
            </h1>
            <div className="lp-rotator" aria-label="Fund what matters">
              <span className="lp-rotator-static">Built for</span>
              <RotatingText
                texts={ROTATING_CAUSES}
                mainClassName="lp-rotator-word"
                staggerFrom="last"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '-120%' }}
                staggerDuration={0.02}
                splitLevelClassName="lp-rotator-split"
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                rotationInterval={2400}
              />
            </div>
            <p className="lp-sub">
              Your QR. Their support. Money straight to your bank — verified by you.
            </p>
            <div className="lp-cta-row">
              <SpecularButton
                size="lg"
                radius={5}
                tint="#6366f1"
                tintOpacity={0.16}
                textColor="#ffffff"
                lineColor="#b6bcfc"
                baseColor="#454b78"
                intensity={1.1}
                shineSize={12}
                shineFade={42}
                thickness={1.1}
                proximity={320}
                onClick={() => navigate(user ? '/dashboard' : '/signup')}
              >
                {user ? 'Open your dashboard' : 'Start a fundraiser — free'}
                <Icon name="arrow-right" size={15} />
              </SpecularButton>
              <a className="lp-ghost-link" href="#how">
                See how it works <Icon name="arrow-right" size={13} />
              </a>
            </div>
            <ul className="lp-ticks">
              <li><Icon name="check" size={13} /> No paperwork</li>
              <li><Icon name="check" size={13} /> Unlimited fundraisers</li>
              <li><Icon name="check" size={13} /> No supporter accounts</li>
            </ul>
          </div>

          <div className="lp-hero-side">
            {stats && (
              <div className="lp-hero-facts">
                <span className="lp-panel-label">
                  <span className="lp-live-dot" aria-hidden="true" /> Platform, live
                </span>
                <div className="lp-panel-raised">
                  <MoneyCounter value={stats.raised} fontSize={30} color="#34d399" background="#10142a" />
                  <span>verified &amp; raised so far</span>
                </div>
                <div className="lp-panel-duo">
                  <div>
                    <strong>{stats.contributions}</strong>
                    <span>verified contributions</span>
                  </div>
                  <div>
                    <strong>{stats.active_campaigns}</strong>
                    <span>live fundraisers</span>
                  </div>
                </div>
              </div>
            )}
            {campaigns[0] && (
              <Link className="lp-panel lp-panel-live" to={`/c/${campaigns[0].slug}`}>
                <span className="lp-panel-label lp-panel-label-mint">Live now</span>
                <span className="lp-panel-title">{campaigns[0].title}</span>
                <span className="lp-live-chip-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(campaigns[0].progress, 100)}%` }} />
                </span>
                <span className="lp-panel-nums">
                  {inrCompact(campaigns[0].raised)} raised of {inrCompact(campaigns[0].goal)}
                  · {Math.min(campaigns[0].progress, 999)}%
                </span>
                <span className="lp-panel-cta">
                  View &amp; support <Icon name="arrow-right" size={13} />
                </span>
              </Link>
            )}
          </div>
        </div>
        <div className="lp-hero-fade" aria-hidden="true" />
      </header>

      {/* ----------------------------------------------- live fundraisers */}
      {campaigns.length > 0 && (
        <section className="lp-live" id="live">
          <div className="lp-container lp-live-head">
            <p className="lp-kicker"><span className="lp-live-dot" aria-hidden="true" /> Live right now</p>
          </div>
          <LogoLoop
            logos={campaigns}
            speed={55}
            direction="left"
            logoHeight={64}
            gap={14}
            hoverSpeed={0}
            fadeOut
            fadeOutColor="#0b0e1a"
            ariaLabel="Ongoing fundraisers"
            renderItem={(c) => (
              <Link to={`/c/${c.slug}`} className="lp-live-chip">
                <span className="lp-live-chip-top">
                  <span className="lp-live-chip-cat">{c.category_label}</span>
                  <span className="lp-live-chip-pct">{Math.min(c.progress, 999)}%</span>
                </span>
                <span className="lp-live-chip-title">{c.title}</span>
                <span className="lp-live-chip-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(c.progress, 100)}%` }} />
                </span>
                <span className="lp-live-chip-nums">
                  {inrCompact(c.raised)} raised of {inrCompact(c.goal)}
                </span>
              </Link>
            )}
          />
        </section>
      )}

      {/* ------------------------------------------------------ how it works */}
      <section className="lp-section" id="how">
        <div className="lp-container">
          <div className="lp-head-center">
            <p className="lp-kicker">How it works</p>
            <ScrollFloat containerClassName="lp-float-head"
                         scrollStart="center bottom+=40%" scrollEnd="bottom bottom-=30%">
              Three steps. No middlemen.
            </ScrollFloat>
          </div>
          <div className="lp-steps">
            {STEPS.map((step) => (
              <article className="lp-step" key={step.num}>
                <span className="lp-step-icon"><Icon name={step.icon} size={20} /></span>
                <h3 className="lp-step-title">{step.title}</h3>
                <p className="lp-step-body">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- security */}
      <section className="lp-security" id="security">
        <CursorGrid
          cellSize={56}
          color="#6366F1"
          radius={150}
          falloff="smooth"
          holdTime={350}
          fadeDuration={900}
          lineWidth={1}
          maxOpacity={0.85}
          fillOpacity={0.05}
          gridOpacity={0.05}
          cellRadius={2}
          clickPulse
          pulseSpeed={520}
        />
        <div className="lp-container lp-security-inner">
          <div className="lp-head-center">
            <p className="lp-kicker">Security first</p>
            <ScrollReveal baseOpacity={0.08} enableBlur baseRotation={2} blurStrength={6}
                          containerClassName="lp-reveal">
              Your money never sits with us. It moves bank to bank —
              and every claim is verified by you.
            </ScrollReveal>
          </div>
          <div className="lp-security-grid">
            {SECURITY_ITEMS.map((item) => (
              <article className="lp-sec-item" key={item.title}>
                <span className="lp-sec-icon"><Icon name={item.icon} size={16} /></span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- FAQ */}
      <section className="lp-section" id="faq">
        <div className="lp-container lp-faq-wrap">
          <div className="lp-head-center">
            <p className="lp-kicker">Questions</p>
            <ScrollFloat containerClassName="lp-float-head"
                         scrollStart="center bottom+=40%" scrollEnd="bottom bottom-=30%">
              Answers, before you ask
            </ScrollFloat>
          </div>
          <Faq items={FAQS} />
        </div>
      </section>

      {/* ---------------------------------------------------------- CTA band */}
      <section className="lp-cta">
        <div className="lp-container lp-cta-inner">
          <h2 className="lp-cta-title">Ready when you are.</h2>
          <p className="lp-cta-sub">
            Free forever — your fundraiser can be live and shareable in the
            next five minutes.
          </p>
          <div className="lp-cta-actions">
            <SpecularButton
              size="md"
              radius={5}
              tint="#10b981"
              tintOpacity={0.18}
              textColor="#ffffff"
              lineColor="#7df0c6"
              baseColor="#3d6b5c"
              intensity={1.1}
              shineSize={12}
              shineFade={42}
              proximity={280}
              onClick={() => navigate(user ? '/dashboard' : '/signup')}
            >
              {user ? 'Go to dashboard' : 'Create your fundraiser'}
              <Icon name="arrow-right" size={14} />
            </SpecularButton>
            {campaigns[0] && (
              <Link className="lp-ghost-link" to={`/c/${campaigns[0].slug}`}>
                See a live fundraiser <Icon name="external" size={13} />
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-footer-logo"><LogoMark size={24} /> <span>Crowd<em>Fund</em></span></span>
            <p>
              Direct, verified community fundraising — payments go straight to the
              organizer, verified by hand.
            </p>
          </div>
          <div className="lp-footer-links">
            <div>
              <span className="lp-footer-h">Product</span>
              <a href="#how">How it works</a>
              <a href="#security">Security</a>
              <a href="#faq">FAQ</a>
            </div>
            <div>
              <span className="lp-footer-h">Get started</span>
              <Link to="/signup">Start a fundraiser</Link>
              <Link to="/login">Sign in</Link>
              {campaigns[0] && <Link to={`/c/${campaigns[0].slug}`}>Live example</Link>}
            </div>
          </div>
        </div>
        <div className="lp-container lp-footer-base">
          <span>© {new Date().getFullYear()} CrowdFund · crowdfund.doxaed.com</span>
          <span className="lp-footer-sec"><Icon name="lock" size={11} /> TLS secured · zero custody · 0% fees</span>
        </div>
      </footer>
    </div>
  )
}

/* Custom accordion — no native <details>, fully keyboard accessible. */
function Faq({ items }) {
  const [open, setOpen] = useState(0)
  return (
    <div className="lp-faq">
      {items.map((item, index) => {
        const isOpen = open === index
        return (
          <div className={`lp-faq-item ${isOpen ? 'is-open' : ''}`} key={item.q}>
            <button
              className="lp-faq-q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : index)}
            >
              <span>{item.q}</span>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
            <div className="lp-faq-a" hidden={!isOpen}>
              <p>{item.a}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
