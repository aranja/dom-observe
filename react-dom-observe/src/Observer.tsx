import BaseObserver from 'dom-observe'
import { Component } from 'react'
import { findDOMNode } from 'react-dom'

export interface Props {
  children: (value: any) => any
  debug?: boolean
  defaultValue: any
  onChange?: (value: any) => void
  value: any
}

class Observer extends Component<Props> {
  public static defaultProps = {
    debug: false,
    defaultValue: false,
  }
  public state = {
    value: this.props.defaultValue,
  }
  private isMounted = false
  private observer?: BaseObserver

  public componentDidMount() {
    this.isMounted = true
    this.observer = new BaseObserver(this.props.value, {
      debug: this.props.debug,
      onChange: this.onChange,
      context: {
        rootElement: findDOMNode(this),
      },
    })
  }

  public componentWillReceiveProps(newProps) {
    if (this.observer) {
      this.observer.update(newProps.value)
    }
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  public render() {
    const { children } = this.props
    if (typeof children === 'function') {
      return children(this.state.value)
    }
    return children
  }

  private onChange = value => {
    if (!this.isMounted) {
      return
    }
    this.setState({ value })
    if (this.props.onChange) {
      this.props.onChange(value)
    }
  }
}

export default Observer
