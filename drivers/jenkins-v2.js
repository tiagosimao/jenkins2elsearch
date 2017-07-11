module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};

let jenkinsBaseUrl;

function setup(settings,ff,rj) {
  if(!settings.url) {
    return rj("No URL set for Jenkins");
  }
  jenkinsBaseUrl=settings.url.endsWith('/')?settings.url:(settings.url+"/");
  ff();
}
