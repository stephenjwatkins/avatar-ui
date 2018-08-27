import { h } from 'preact';

const SVGSymbols = () => (
  <div style="display:block;width:0;height:0;">
    <svg>
      <symbol id="add-photo" viewBox="0 0 66 66">
        <g transform="translate(1 1)" stroke-width="2" stroke="currentColor" fill="none" fill-rule="evenodd">
          <path d="M42.343 41.958c-3.932-.828-8.786-1.425-14.61-1.425-11.882 0-19.727 2.487-23.95 4.36A6.376 6.376 0 0 0 0 50.738v11.129h34.133M12.8 14.933C12.8 6.686 19.486 0 27.733 0c8.248 0 14.934 6.686 14.934 14.933C42.667 23.181 35.98 32 27.733 32 19.486 32 12.8 23.18 12.8 14.933zM51.2 46.933v8.534M46.933 51.2h8.534"/>
          <circle cx="51.2" cy="51.2" r="12.8"/>
        </g>
      </symbol>
      <symbol id="upload" viewBox="0 0 20 14">
        <path d="M16.71 5.839C16.258 2.484 13.42 0 10 0a6.732 6.732 0 0 0-6.42 4.613C1.485 5.065 0 6.87 0 9.033c0 2.354 1.839 4.322 4.194 4.515h12.29c1.968-.193 3.516-1.87 3.516-3.87a3.913 3.913 0 0 0-3.29-3.84zm-3.258 1.806a.293.293 0 0 1-.226.097.293.293 0 0 1-.226-.097l-2.677-2.677v6.322c0 .194-.13.323-.323.323-.194 0-.323-.13-.323-.323V4.968L7 7.645a.312.312 0 0 1-.452 0 .312.312 0 0 1 0-.451l3.226-3.226c.032-.033.065-.065.097-.065.064-.032.161-.032.258 0 .032.032.065.032.097.065l3.226 3.226a.312.312 0 0 1 0 .451z" stroke="none" fill="currentColor" fill-rule="evenodd"/>
      </symbol>
      <symbol id="take-picture" viewBox="0 0 18 16">
        <path d="M6.097 1.161H2.032v-.87c0-.16.13-.291.29-.291h3.484c.16 0 .29.13.29.29v.871zM17.42 1.742H.58a.58.58 0 0 0-.58.58v12.775c0 .32.26.58.58.58h16.84c.32 0 .58-.26.58-.58V2.323a.58.58 0 0 0-.58-.581zM4.064 5.516a.581.581 0 1 1 0-1.162.581.581 0 0 1 0 1.162zm7.258 7.258A3.779 3.779 0 0 1 7.548 9a3.779 3.779 0 0 1 3.775-3.774A3.779 3.779 0 0 1 15.097 9a3.779 3.779 0 0 1-3.774 3.774z" stroke="none" fill="currentColor" fill-rule="evenodd"/>
      </symbol>
      <symbol id="crop" viewBox="0 0 18 18">
        <g stroke-width="2" stroke="currentColor" fill="none" fill-rule="evenodd">
          <path d="M4.09 0v4.91M13.91 16.364V18M0 4.91h13.91v8.18"/>
          <path d="M4.09 8.182v4.909H18"/>
        </g>
      </symbol>
      <symbol id="filters" viewBox="0 0 18 18">
        <g stroke="none" fill="currentColor" fill-rule="evenodd">
          <circle cx="9" cy="5.25" r="5.25"/>
          <path d="M15.131 8.075a6.748 6.748 0 0 1-3.275 3.29 6.717 6.717 0 0 1-1.664 5.968A5.25 5.25 0 0 0 18 12.75a5.246 5.246 0 0 0-2.869-4.676zM9 12c-2.713 0-5.053-1.613-6.124-3.928A5.245 5.245 0 0 0 0 12.75a5.25 5.25 0 1 0 10.5 0c0-.308-.032-.609-.083-.902C9.96 11.946 9.486 12 9 12z"/>
        </g>
      </symbol>
      <symbol id="check" viewBox="0 0 18 15">
        <path d="M6.3 14.4L0 8.1l2.7-2.7L6.3 9l9-9L18 2.7z" stroke="none" fill="currentColor" fill-rule="evenodd"/>
      </symbol>
    </svg>
  </div>
);

export default SVGSymbols;
