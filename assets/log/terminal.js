(function(){
  "use strict";
  window.TidyTerminalLog = {
    append: function(job, message){
      if(!job) return;
      if(!job.logLines) job.logLines=[];
      job.logLines.push(message);
      this.render(job);
    },
    render: function(job){
      var el=document.getElementById('jobLogBody');
      if(!el || !job || !job.logLines) return;
      el.innerHTML=job.logLines.map(function(line){
        var div=document.createElement('div');
        div.className='job-log-line';
        div.textContent=line;
        return div.outerHTML;
      }).join('');
      el.scrollTop=el.scrollHeight;
    }
  };
})();
