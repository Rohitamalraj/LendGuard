"use client";

import { useEffect, useState, useRef } from "react";
import { AsciiDna } from "./ascii-dna";

const regions = [
  { name: "Encrypt", status: "FHE Risk Engine", latency: "Private Risk" },
  { name: "Ika", status: "dWallet Custody", latency: "Proven Collateral" },
  { name: "Covalent", status: "GoldRush Events", latency: "Real-time Index" },
  { name: "Torque MCP", status: "Multi-chain Ready", latency: "Future Scale" },
  { name: "Solana Devnet", status: "Anchor Program", latency: "Main Protocol" },
  { name: "Next.js", status: "Demo UI", latency: "3-min Walkthrough" },
];

export function InfrastructureSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-32 bg-muted/30 overflow-hidden">
      {/* ASCII DNA Background */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-10 pointer-events-none">
        <AsciiDna className="w-[600px] h-[500px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Content */}
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
            }`}
          >
            <p className="text-sm font-mono text-primary mb-4">// SPONSOR INTEGRATIONS</p>
            <h2 className="text-4xl lg:text-5xl font-semibold tracking-tight mb-6 text-balance">
              Built on proven protocols.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8">
              LendGuard is powered by industry-leading infrastructure: Ika for custody proofs,
              Encrypt for FHE computation, Covalent for on-chain indexing, and Torque for multi-chain expansion.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <pre className="font-mono text-2xl text-primary">🔐</pre>
                <div>
                  <h3 className="font-semibold mb-1">Encrypt FHE</h3>
                  <p className="text-sm text-muted-foreground">
                    Encrypted predicate evaluation with REFHE
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <pre className="font-mono text-2xl text-primary">💳</pre>
                <div>
                  <h3 className="font-semibold mb-1">Ika dWallets</h3>
                  <p className="text-sm text-muted-foreground">
                    2PC-MPC custody proofs, cryptographically unforgeable
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <pre className="font-mono text-2xl text-primary">📊</pre>
                <div>
                  <h3 className="font-semibold mb-1">GoldRush Analytics</h3>
                  <p className="text-sm text-muted-foreground">
                    Real-time event indexing and protocol health monitoring
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Regions Grid */}
          <div
            className={`transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
            <div className="grid grid-cols-1 gap-3">
              {regions.map((region, index) => (
                <div
                  key={region.name}
                  className="group relative bg-card rounded-lg p-5 border border-border card-shadow hover:border-primary/50 transition-all duration-300"
                  style={{ transitionDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">{region.name}</h4>
                    <span className="font-mono text-xs text-primary">{region.latency}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      {region.status}
                    </span>
                  </div>
                  
                  {/* Animated status indicator */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <span className="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="mt-8 p-6 rounded-lg bg-foreground/5 border border-border">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="font-mono text-2xl font-semibold text-primary">3</div>
                  <div className="text-xs text-muted-foreground">Core Layers</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold text-primary">4</div>
                  <div className="text-xs text-muted-foreground">Sponsors</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold text-primary">$292M</div>
                  <div className="text-xs text-muted-foreground">KelpDAO Prevention</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
