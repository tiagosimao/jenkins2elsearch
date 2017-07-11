module.exports.boot = function(mondego){
    return Promise.all(getAllBooters(mondego));
};

function getAllBooters(mondego){
  let booters = [];
  booters = booters.concat(getBooters(mondego));
  booters = booters.concat(mondego.writer.module.setup(mondego.writer.settings));
  return booters;
}

function getBooters(mondego){
  const booters = new Array();
  const ks = Object.keys(mondego.drivers);
  for(let i = 0; i<ks.length; ++i) {
    console.log("Booting driver: " + ks[i]);
    if(mondego.drivers[ks[i]].module.setup){
      booters.push(mondego.drivers[ks[i]].module.setup(mondego.drivers[ks[i]].settings));
    } else {
      console.warn("Booting driver: " + ks[i] + "... warning: no setup method found");
    }
  }
  return booters;
}
