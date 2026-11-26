// Holiday greeting button: on Thanksgiving (4th Thursday of November, Eastern time) a "Send a Happy Thanksgiving card"
// button shows near the top of the stats and Next game pages. It opens the usual share card (scripts/share.js) with
// the turkey-leg background (share library key share-bg-thanksgiving) and "Happy Thanksgiving". ?tg previews it.
(function(){
  var spot = document.getElementById('holiday'); if(!spot) return;
  var d = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'}).split('-'), day = +d[2];
  var tg = d[1] === '11' && day >= 22 && day <= 28 && new Date(+d[0], 10, day).getDay() === 4;
  if(!tg && !/[?&]tg\b/.test(location.search)) return;
  var card = {title: 'Happy Thanksgiving', bg: 'share-bg-thanksgiving', url: '', share: 'Happy Thanksgiving from Not Joshing Around 🦃'};
  spot.innerHTML = '<button type="button" class="tgsend" data-share=\'' + JSON.stringify(card).replace(/'/g, '&#39;') + '\'>'
    + '<span aria-hidden="true">🦃</span> Send a Happy Thanksgiving card</button>';
  spot.hidden = false;
})();
