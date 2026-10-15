/**
 * When the Maps key rejects this host (or billing is off), Google's Places
 * Autocomplete disables the input, swaps its placeholder for an error, or
 * opens an error dropdown over the field. Keep the field usable so riders
 * can still type and pick a catalog stop.
 */
const PAC_ERROR = /can.t load Google Maps|Something went wrong/i

function placesOff() {
  // Google's own dropdown would only repeat the error and cover our catalog list.
  document.documentElement.setAttribute('data-places-off', '')
}

function pacShowsError() {
  return [...document.querySelectorAll('.pac-container')].some((el) => PAC_ERROR.test(el.textContent || ''))
}

export function keepInputUsable(input, placeholder) {
  if (!input || typeof MutationObserver === 'undefined') return () => {}
  const restore = () => {
    if (!input.classList.contains('gm-err-autocomplete') && !input.disabled) return
    placesOff()
    input.classList.remove('gm-err-autocomplete')
    input.disabled = false
    input.removeAttribute('disabled')
    input.style.backgroundImage = 'none'
    if (placeholder) input.placeholder = placeholder
  }
  const observer = new MutationObserver(restore)
  observer.observe(input, { attributes: true, attributeFilter: ['class', 'disabled', 'placeholder'] })
  let timer = null
  const checkDropdown = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { if (pacShowsError()) placesOff() }, 250)
  }
  input.addEventListener('input', checkDropdown)
  input.addEventListener('focus', checkDropdown)
  restore()
  return () => {
    observer.disconnect()
    clearTimeout(timer)
    input.removeEventListener('input', checkDropdown)
    input.removeEventListener('focus', checkDropdown)
  }
}
