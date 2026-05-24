(function () {
  const slider = document.getElementById("slider");
  if (!slider) return;

  const slides = Array.from(slider.querySelectorAll(".slide"));
  let index = 0, timerId = null;

  function showSlide(n) {
    slides[index].classList.remove("is-active");
    index = (n + slides.length) % slides.length;
    slides[index].classList.add("is-active");
  }
  function next() { showSlide(index + 1); }
  function prev() { showSlide(index - 1); }
  function start() { timerId = setInterval(next, 3000); }
  function stop()  { clearInterval(timerId); timerId = null; }

  slider.querySelector(".next")?.addEventListener("click", () => { next(); stop(); start(); });
  slider.querySelector(".prev")?.addEventListener("click", () => { prev(); stop(); start(); });
  slider.addEventListener("mouseenter", stop);
  slider.addEventListener("mouseleave", start);
  slider.addEventListener("touchstart", stop,  { passive: true });
  slider.addEventListener("touchend",   start);

  start();
})();