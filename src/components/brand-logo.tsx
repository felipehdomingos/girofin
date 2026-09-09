import Image from "next/image";

export function BrandLogo({ withSlogan = false }: { withSlogan?: boolean }) {
  return (
    <div className={withSlogan ? "brand-lockup brand-lockup--with-slogan" : undefined}>
      <span className="brand-logo" aria-label="GiroFin">
        <Image
          className="brand-logo__image brand-logo__image--light"
          src="/brand/girofin-dark.png"
          alt="GiroFin"
          width={144}
          height={96}
          priority
        />
        <Image
          className="brand-logo__image brand-logo__image--dark"
          src="/brand/girofin-light.png"
          alt=""
          width={144}
          height={96}
          priority
        />
      </span>
      {withSlogan ? <p className="brand-slogan">Organize hoje. Viva um futuro melhor.</p> : null}
    </div>
  );
}
