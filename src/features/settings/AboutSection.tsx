import { PRODUCT_DATA } from '../dinLookup/dataVersion'

export default function AboutSection() {
  return (
    <section className="settings-group" aria-labelledby="st-about">
      <h3 id="st-about">About</h3>
      <p className="muted">
        Product data as of {PRODUCT_DATA.generatedAt}. Contains information licensed under the Open Government Licence –
        Canada.
      </p>
    </section>
  )
}
